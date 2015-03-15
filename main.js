var fs = require('fs');
var moment = require('moment');
var _ = require('lodash');
var Promise = require('bluebird');
var commander = require('commander');
var nunjucks = require('nunjucks');

commander
  .option('--source <fileName>', 'source file name (JSON)')
  .option('--target <fileName>', 'target file name (TeX)')
  .parse(process.argv);

var readFile = Promise.promisify(fs.readFile);
var render = Promise.promisify(nunjucks.render);
var writeFile = Promise.promisify(fs.writeFile);

var logError = function(err) {
  console.error('ERROR `%s`', err);
  process.exit(-1);
};

var pipe = function(tasks, seed) {
  return Promise.reduce(tasks
    , function(arg, task) { return task(arg); }, seed || null);
};

var readSourceFile = function(opts) {
  var getSourceFile = function() {
    return new Promise(function(resolve, reject) {
      opts.source ? resolve(opts.source)
        : reject('no source file supplied');
    });
  };
  var readFileUTF8 = _.partial(readFile, _, 'utf8');
  return pipe([ getSourceFile, readFileUTF8, JSON.parse ]);
};
readSourceFile = _.partial(readSourceFile, commander);

var processSourceFile = function(cv) {
  cv.lastName = cv.lastName + ' *';
  return cv;
};

var renderTargetFile = function(cv) {
  return render('tex/cv.tex', cv);
};

var writeTargetFile = function(opts, content) {
  var getTargetFile = function() {
    return new Promise(function(resolve, reject) {
      opts.target ? resolve(opts.target)
        : reject('no target file supplied');
    });
  };
  console.log(content);
  var writeFileContent = _.partial(writeFile, _, content);
  return pipe([ getTargetFile, writeFileContent ]);
};
writeTargetFile = _.partial(writeTargetFile, commander);

var renderTeX = function() {
  return pipe([ readSourceFile, processSourceFile, renderTargetFile
    , writeTargetFile, process.exit ]).catch(logError);
};

module.exports = { renderTeX: renderTeX };
