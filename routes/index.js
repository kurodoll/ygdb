const express = require('express');
const router = express.Router();

const bcrypt = require('bcrypt');


// * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //
// *                                                          * // App Init //
const website_name = 'Yasei';

try {
  config = require('../config');
}
catch (e) {
  console.warn('No config file found.');
}


// * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //
// *                                                           * // DB Init //
const pg = require('pg');
const url = require('url');

let db_url;
let pg_pool;

if (process.env.DATABASE_URL) {
  db_url = process.env.DATABASE_URL;
}
else {
  db_url = config.db.url;
}

if (db_url) {
  const params = url.parse(db_url);
  const auth = params.auth.split(':');

  const pg_config = {
    host: params.hostname,
    port: params.port,
    user: auth[0],
    password: auth[1],
    database: params.pathname.split('/')[1],
    ssl: true,
    max: 10,
    idleTimeoutMillis: 30000 };

  pg_pool = new pg.Pool(pg_config);
}
else {
  console.error('Couldn\'t connect to database as no config could be loaded.');
}

pg_pool.on('error', function(err, client) {
  console.error('Idle client error: ', err.message, err.stack);
});


// * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //
// *                                                      * // User Session //
const sessions = require('client-sessions');
const keygen = require('generate-key');

const one_week = 1000 * 60 * 60 * 24 * 7;

const sessionsConfig = sessions({
  cookieName: 'session',
  secret: keygen.generateKey(60),
  duration: one_week,
  activeDuration: one_week,
  httpOnly: true, // Prevents clients from using JavaScript to access cookies
  secure: true }); // Ensures that cookies are only sent over HTTPS

// res.session.user is the logged in user's username.
// res.locals contains the user's full details
const sessionsMiddleware = function(req, res, next) {
  if (req.session && req.session.user) {
    const query = 'SELECT * FROM users WHERE username = $1;';
    const vars = [ req.session.user ];

    pg_pool.query(query, vars, function(err, result) {
      if (err) {
        console.error(err);
      }
      else if (result.rows.length) {
        res.locals.user = result.rows[0];
        delete res.locals.user.password;
        req.user = res.locals.user;
      }

      next();
    });
  }
  else {
    next();
  }
};

function requireLogin(req, res, next) {
  if (req.session.user) {
    next();
  }
  else {
    // Remember where user was trying to go
    req.session.return_to = req.originalUrl;
    res.redirect('/login');
  }
}

router.use(sessionsConfig);
router.use(sessionsMiddleware);


// * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //
// *                                                 * // General Functions //
function getTimestamp() {
  return new Date(new Date().getTime()).toISOString();
}


// * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //
// *                                                           * // Routing //
router.get('/', function(req, res, next) {
  res.render('index', { title: website_name });
});

// ---------------------------------------------------------------------- Games
router.get('/games', function(req, res, next) {
  const query = 'SELECT * FROM games;';

  pg_pool.query(query, function(err, result) {
    if (err) {
      console.error(err);
    }

    res.render('games', {
      title: 'Games - ' + website_name,
      games: result.rows });
  });
});

router.get('/games/new', requireLogin, function(req, res, next) {
  res.render('games/new', {
    title: 'Add new game - ' + website_name,
    form: {} });
});

router.post('/games/new', requireLogin, function(req, res, next) {
  const form = req.body;
  let error = '';

  if (!form.title) {
    error = 'A required field was left blank';
  }

  if (error) {
    res.render('games/new', {
      title: 'Add new game - ' + website_name,
      error: error,
      form: form });
  }
  else {
    let query = `
      INSERT INTO games (
        title,
        title_romaji,
        aliases,
        description,
        creator,
        screenshots,
        links,
        created,
        created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *;`;

    let vars = [
      form.title,
      form.title_romaji ? form.title_romaji : null,
      form.aliases ? form.aliases : null,
      form.description ? form.description : null,
      form.creator ? form.creator : null,
      form.screenshots ? form.screenshots : null,
      form.links ? form.links : null,
      getTimestamp(),
      res.locals.user.id ];

    pg_pool.query(query, vars, function(err, result) {
      if (err) {
        console.error(err);

        res.render('games/new', {
          title: 'Add new game - ' + website_name,
          error: 'Something went wrong. Please try again',
          form: form });
      }
      else {
        query = `
          INSERT INTO revisions (
            game_id,
            nth_revision,
            title,
            title_romaji,
            aliases,
            description,
            creator,
            screenshots,
            links,
            message,
            created,
            created_by)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12);`;

        vars = [
          result.rows[0].id,
          result.rows[0].revisions,
          form.title,
          form.title_romaji ? form.title_romaji : null,
          form.aliases ? form.aliases : null,
          form.description ? form.description : null,
          form.creator ? form.creator : null,
          form.screenshots ? form.screenshots : null,
          form.inks ? form.links : null,
          '(System) New entry',
          getTimestamp(),
          res.locals.user.id ];

        pg_pool.query(query, vars, function(err2, result2) {
          if (err2) {
            console.error(err2);
          }

          res.redirect('/games');
        });
      }
    });
  }
});

router.get('/games/:id', function(req, res, next) {
  const query = `
    SELECT
      *,

      array(SELECT json_build_object(
        'id', id,
        'region', region,
        'type', type,
        'title', title,
        'title_romaji', title_romaji,
        'version', version,
        'release_date', release_date)
          FROM releases WHERE game_id = $1)
            AS releases

    FROM games WHERE id = $1;`;


  const vars = [ req.params.id ];

  pg_pool.query(query, vars, function(err, result) {
    if (err) {
      console.error(err);
    }

    res.render('games/game', {
      title: result.rows[0].title + ' - ' + website_name,
      game: result.rows[0] });
  });
});

// ------------------------------------------------------------------ Edit Game
router.get('/games/edit/:id', requireLogin, function(req, res, next) {
  const query = 'SELECT * FROM games WHERE id = $1;';
  const vars = [ req.params.id ];

  pg_pool.query(query, vars, function(err, result) {
    if (err) {
      console.error(err);
    }

    res.render('games/new', {
      title: 'Editing ' + result.rows[0].title + ' - ' + website_name,
      form: result.rows[0] });
  });
});

router.post('/games/edit/:id', requireLogin, function(req, res, next) {
  const form = req.body;
  let error = '';

  if (!form.title) {
    error = 'A required field was left blank';
  }
  else if (!form.revision_message) {
    error = 'A revision message is required';
  }

  if (error) {
    res.render('games/new', {
      title: 'Editing ' + form.title + ' - ' + website_name,
      error: error,
      form: form });
  }
  else {
    const query = 'SELECT * FROM games WHERE id = $1;';
    const vars = [ req.params.id ];

    pg_pool.query(query, vars, function(err, result) {
      if (err) {
        console.error(err);

        res.render('games/new', {
          title: 'Editing ' + result.rows[0].title + ' - ' + website_name,
          error: 'Something went wrong. Please try again',
          form: form });
      }
      else {
        let query = `
          UPDATE games
          SET
            title = $2,
            title_romaji = $3,
            aliases = $4,
            description = $5,
            creator = $6,
            screenshots = $7,
            links = $8,
            revisions = dummy.revisions + 1
          FROM (SELECT * FROM games WHERE id = $1 FOR UPDATE) dummy
          WHERE games.id = dummy.id
          RETURNING dummy.*;`;

        let vars = [
          req.params.id,
          form.title,
          form.title_romaji,
          form.aliases,
          form.description,
          form.creator,
          form.screenshots,
          form.links ];

        pg_pool.query(query, vars, function(err2, result2) {
          if (err2) {
            console.error(err2);

            res.render('games/new', {
              title: 'Editing ' + result.rows[0].title + ' - ' + website_name,
              error: 'Something went wrong. Please try again',
              form: form });
          }
          else {
            query = `
              INSERT INTO revisions (
                game_id,
                nth_revision,
                title,
                title_romaji,
                aliases,
                description,
                creator,
                screenshots,
                links,
                message,
                created,
                created_by)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12);`;

            vars = [
              req.params.id,
              result.rows[0].revisions + 1,

              form.title == result.rows[0].title ?
                null : form.title,

              form.title_romaji == result.rows[0].title_romaji ?
                null : form.title_romaji,

              form.aliases == result.rows[0].aliases ?
                null : form.aliases,

              form.description == result.rows[0].description ?
                null : form.description,

              form.creator == result.rows[0].creator ?
                null : form.creator,

              form.screenshots == result.rows[0].screenshots ?
                null : form.screenshots,

              form.links == result.rows[0].links ?
                null : form.links,

              form.revision_message,
              getTimestamp(),
              res.locals.user.id ];

            pg_pool.query(query, vars, function(err2, result2) {
              if (err2) {
                console.error(err2);
              }

              res.redirect('/games/' + req.params.id.toString());
            });
          }
        });
      }
    });
  }
});

// ------------------------------------------------------------------- Releases
router.get('/releases/new/:game_id', requireLogin, function(req, res, next) {
  const query = 'SELECT * FROM games WHERE id = $1;';
  const vars = [ req.params.game_id ];

  pg_pool.query(query, vars, function(err, result) {
    if (err) {
      console.error(err);
    }

    res.render('releases/new', {
      title: 'Add new release - ' + website_name,
      game: result.rows[0],
      form: {} });
  });
});

router.post('/releases/new/:game_id', requireLogin, function(req, res, next) {
  let query = 'SELECT * FROM games WHERE id = $1;';
  let vars = [ req.params.game_id ];

  pg_pool.query(query, vars, function(err, result) {
    if (err) {
      console.error(err);
    }

    const form = req.body;
    let error = '';

    if (!form.region || !form.title || !form.version) {
      error = 'A required field was left blank';
    }

    if (error) {
      res.render('releases/new', {
        title: 'Add new release - ' + website_name,
        error: error,
        game: result.rows[0],
        form: form });
    }
    else {
      query = `
        INSERT INTO releases (
          game_id,
          region,
          type,
          title,
          title_romaji,
          version,
          release_date,
          created,
          created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *;`;

      vars = [
        result.rows[0].id,
        form.region,
        form.type,
        form.title,
        form.title_romaji ? form.title_romaji : null,
        form.version,
        form.release_date ? form.release_date : null,
        getTimestamp(),
        res.locals.user.id ];

      pg_pool.query(query, vars, function(err, result) {
        if (err) {
          console.error(err);

          res.render('releases/new', {
            title: 'Add new release - ' + website_name,
            error: 'Something went wrong. Please try again',
            game: result.rows[0],
            form: form });
        }
        else {
          query = `
            INSERT INTO release_revisions (
              release_id,
              nth_revision,
              region,
              type,
              title,
              title_romaji,
              version,
              release_date,
              message,
              created,
              created_by)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11);`;

          vars = [
            result.rows[0].id,
            result.rows[0].revisions,
            form.region,
            form.type,
            form.title,
            form.title_romaji ? form.title_romaji : null,
            form.version,
            form.release_date ? form.release_date : null,
            '(System) New entry',
            getTimestamp(),
            res.locals.user.id ];

          pg_pool.query(query, vars, function(err2, result2) {
            if (err2) {
              console.error(err2);
            }

            res.redirect('/games');
          });
        }
      });
    }
  });
});

// --------------------------------------------------------------- Edit Release
router.get('/releases/edit/:id', requireLogin, function(req, res, next) {
  let query = 'SELECT * FROM releases WHERE id = $1;';
  let vars = [ req.params.id ];

  pg_pool.query(query, vars, function(err, result) {
    if (err) {
      console.error(err);
    }

    query = 'SELECT * FROM games WHERE id = $1;';
    vars = [ result.rows[0].game_id ];

    pg_pool.query(query, vars, function(err2, result2) {
      if (err2) {
        console.error(err2);
      }

      res.render('releases/new', {
        title: 'Edit release - ' + website_name,
        game: result2.rows[0],
        form: result.rows[0] });
    });
  });
});

router.post('/releases/edit/:id', requireLogin, function(req, res, next) {
  const form = req.body;
  let error = '';

  if (!form.region || !form.title || !form.version) {
    error = 'A required field was left blank';
  }
  else if (!form.revision_message) {
    error = 'A revision message is required';
  }

  if (error) {
    query = 'SELECT * FROM games WHERE id = $1;';
    vars = [ form.game_id ];

    pg_pool.query(query, vars, function(err, result) {
      if (err) {
        console.error(err);
      }

      res.render('releases/new', {
        title: 'Edit release - ' + website_name,
        error: error,
        game: result.rows[0],
        form: form });
    });
  }
  else {
    let query = 'SELECT * FROM releases WHERE id = $1;';
    let vars = [ req.params.id ];

    pg_pool.query(query, vars, function(err, result) {
      if (err) {
        console.error(err);

        query = 'SELECT * FROM games WHERE id = $1;';
        vars = [ form.game_id ];

        pg_pool.query(query, vars, function(err2, result2) {
          if (err2) {
            console.error(err2);
          }

          res.render('releases/new', {
            title: 'Edit release - ' + website_name,
            error: 'Something went wrong. Please try again',
            game: result2.rows[0],
            form: form });
        });
      }
      else {
        query = `
          UPDATE releases
          SET
            region = $2,
            type = $3,
            title = $4,
            title_romaji = $5,
            version = $6,
            release_date = $7,
            revisions = dummy.revisions + 1
          FROM (SELECT * FROM releases WHERE id = $1 FOR UPDATE) dummy
          WHERE releases.id = dummy.id
          RETURNING dummy.*;`;

        vars = [
          req.params.id,
          form.region,
          form.type,
          form.title,
          form.title_romaji,
          form.version,
          form.release_date ];

        pg_pool.query(query, vars, function(err2, result2) {
          if (err2) {
            console.error(err2);

            query = 'SELECT * FROM games WHERE id = $1;';
            vars = [ form.game_id ];

            pg_pool.query(query, vars, function(err3, result3) {
              if (err3) {
                console.error(err3);
              }

              res.render('releases/new', {
                title: 'Edit release - ' + website_name,
                error: 'Something went wrong. Please try again',
                game: result3.rows[0],
                form: form });
            });
          }
          else {
            query = `
              INSERT INTO release_revisions (
                release_id,
                nth_revision,
                region,
                type,
                title,
                title_romaji,
                version,
                release_date,
                message,
                created,
                created_by)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11);`;

            vars = [
              req.params.id,
              result2.rows[0].revisions + 1,

              form.region == result.rows[0].region ?
                null : form.region,

               form.type == result.rows[0].type ?
                null : form.type,

              form.title == result.rows[0].title ?
                null : form.title,

              form.title_romaji == result.rows[0].title_romaji ?
                null : form.title_romaji,

              form.version == result.rows[0].version ?
                null : form.version,

              form.release_date == result.rows[0].release_date ?
                null : form.release_date,

              form.revision_message,
              getTimestamp(),
              res.locals.user.id ];

            pg_pool.query(query, vars, function(err3, result3) {
              if (err3) {
                console.error(err3);
              }

              res.redirect('/releases/' + req.params.id.toString());
            });
          }
        });
      }
    });
  }
});

// ---------------------------------------------------------------------- Login
router.get('/login', function(req, res, next) {
  if (req.session.user) {
    res.redirect('/');
  }
  else {
    res.render('user/login', {
      title: 'Login - ' + website_name,
      form: {} });
  }
});

router.post('/login', function(req, res, next) {
  const form = req.body;
  let error = '';

  if (!form.username || !form.password) {
    error = 'A required field was left blank';
  }
  else if (form.username.length > 20 || form.password.length > 1000) {
    error = 'Bypassing the character limit is bad!';
  }
  else {
    const query = 'SELECT * FROM users WHERE username = $1;';
    const vars = [ form.username ];

    pg_pool.query(query, vars, function(err, result) {
      if (err) {
        console.error(err);
        error = 'Something went wrong. Please try again';
      }
      else if (result.rows.length <= 0) {
        error = 'Invalid credentials';
      }
      else {
        if (bcrypt.compareSync(form.password, result.rows[0].password)) {
          req.session.user = form.username;
          res.redirect(req.session.return_to ? req.session.return_to : '/');
        }
        else {
          error = 'Invalid credentials';
        }
      }

      if (error) {
        res.render('user/login', {
          title: 'Login - ' + website_name,
          error: error,
          form: form });
      }
    });
  }

  if (error) {
    res.render('user/login', {
      title: 'Login - ' + website_name,
      error: error,
      form: form });
  }
});

// ------------------------------------------------------------------- Register
router.get('/register', function(req, res, next) {
  if (req.session.user) {
    res.redirect('/');
  }
  else {
    res.render('user/register', {
      title: 'Register - ' + website_name,
      form: {} });
  }
});

router.post('/register', function(req, res, next) {
  const form = req.body;
  let error = '';

  if (!form.username || !form.password) {
    error = 'A required field was left blank';
  }
  else if (form.username.length < 3 || form.username.length > 20) {
    error = 'Username must be between 3 and 20 characters long (inclusive)';
  }
  else if (!isPlainText(form.username)) {
    error = 'Username must use only plain text characters (a-z, A-Z, 0-9)';
  }
  else if (form.password.length < 10 || form.password.length > 1000) {
    error = 'Password must be between 10 and 1000 characters long (inclusive)';
  }
  else {
    doesUsernameExist(form.username, function(exists) {
      if (exists) {
        res.render('user/register', {
          title: 'Register - ' + website_name,
          error: 'Username is taken',
          form: form });
      }
      else {
        registerUser(form, res);
      }
    });
  }

  if (error) {
    res.render('user/register', {
      title: 'Register - ' + website_name,
      error: error,
      form: form });
  }
});

function isPlainText(text) {
  const regex = /^[a-zA-Z0-9]*$/;
  return regex.test(text);
}

function doesUsernameExist(username, callback) {
  const query = 'SELECT * FROM users WHERE username = $1;';
  const vars = [ username ];

  pg_pool.query(query, vars, function(err, res) {
    if (err) {
      console.error(err);
      callback(true);
    }
    else {
      callback(res.rows.length > 0);
    }
  });
}

function registerUser(user, res) {
  // Hash the password before saving it to the database
  const salt = bcrypt.genSaltSync(10);
  const hash = bcrypt.hashSync(user.password, salt);

  const query = `
    INSERT INTO users (
      username,
      password,
      created)
    VALUES ($1, $2, $3);`;

  const vars = [
    user.username,
    hash,
    getTimestamp() ];

  pg_pool.query(query, vars, function(err, result) {
    if (err) {
      console.error(err);

      res.render('user/register', {
        title: 'Register - ' + website_name,
        error: 'Something went wrong. Please try again',
        form: user });
    }
    else {
      res.render('user/login', {
        title: 'Login - ' + website_name,
        message: 'Account created. You may now login',
        form: user });
    }
  });
}

// --------------------------------------------------------------------- Logout
router.get('/logout', function(req, res, next) {
  req.session.reset();
  res.redirect('/');
});

module.exports = router;
