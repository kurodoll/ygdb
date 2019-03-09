const express = require('express');
const router = express.Router();


// * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //
// *                                                          * // App Init //
const website_name = '野生GameDB';


// * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //
// *                                                           * // Routing //
router.get('/', function(req, res, next) {
  res.render('index', { title: website_name });
});

router.get('/register', function(req, res, next) {
  res.render('user/register', {
    title: 'Register - ' + website_name,
    form: {} });
});

module.exports = router;
