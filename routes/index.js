const express = require('express');
const router = express.Router();

const bcrypt = require('bcrypt');


// * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //
// *                                                          * // App Init //
const website_name = '野生GameDB';

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
// *                                                 * // General Functions //
function getTimestamp() {
  return new Date(new Date().getTime()).toISOString();
}


// * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //
// *                                                           * // Routing //
router.get('/', function(req, res, next) {
  res.render('index', { title: website_name });
});

// ------------------------------------------------------------------- Register
router.get('/register', function(req, res, next) {
  res.render('user/register', {
    title: 'Register - ' + website_name,
    form: {} });
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

module.exports = router;
