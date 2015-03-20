var format = require('util').format;
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

var recursive = function(obj, proc, pred) {
  pred = pred || _.partial(_.identity, true);
  (function recurse(parent, val, key) {
    _.isObject(val) ? _.map(val, _.partial(recurse, val))
      : pred(val) && (parent[key] = proc(val));
  })(null, obj);
};

var pipe = function(tasks, seed) {
  return Promise.reduce(tasks
    , function(arg, task) { return task(arg); }, seed || null);
};

var pwhile = function(pred, act, seed) {
  return new Promise(function(resolve, reject) {
    (function loop(item) {
      var forward = function(item) {
        return pred(item) ? act(item).then(loop) : resolve(item);
      };
      return Promise.resolve(item).then(forward);
    })(seed).catch(reject);
  });
};

var locales = { };

locales.en = { typesetWith: 'Typeset with', objective: 'Objective'
  , education: 'Education', employment: 'Employment'
  , experience: 'Experience', proficiency: 'Technical proficiency'
  , languages: 'Languages'
};

locales.es = { typesetWith: 'Tipografía', objective: 'Objetivo'
  , education: 'Formación', employment: 'Experiencia laboral'
  , experience: 'Experiencia profecional', proficiency: 'Conocimientos técnicos'
  , languages: 'Idiomas' };

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
  var processLocale = function(cv) {
    cv.locale = locales[cv.meta.locale] || locales['en'];
    return cv;
  };
  var processDates = function(cv) {
    moment.locale('es', { monthsShort:
      'Ene_Feb_Mar_Abr_May_Jun_Jul_Ago_Sep_Oct_Nov_Dic'.split('_') });
    moment.locale(cv.meta.locale);
    var isDate = function(val) {
      return _.isString(val) && /^\d{4}-\d{2}-\d{2}$/.test(val);
    };
    var processDate = function(date) {
      return moment(date).format('MMM YYYY');
    };
    recursive(cv, processDate, isDate);
    return cv;
  };
  var processURLs = function(cv) {
    var counter = 0;
    var processURL = function(str) {
      return str.replace(/\[([^\]]+)\]\(([^\)]+)\)/g
        , function(markup, name, url) {
        ++counter;
        var useURL = format('\\useURL[url:auto%s][%s][][%s]'
          , counter, url, name);
        cv.urls.push(useURL);
        return format('\\from[url:auto%s]', counter);
      });
    };
    cv.urls = [ ];
    recursive(cv, processURL, _.isString);
    return cv;
  };
  var processChars = function(cv) {
    var processChar = function(str) {
      return str.replace(/ -- /, '~\\endash~')
        .replace(/ --- /, '~\\emdash~');
    };
    recursive(cv, processChar, _.isString);
    return cv;
  };
  var escapeTeX = function(cv) {
    var escape = function(str) {
      return str.replace(/[&%#_\$\{\}]/g, function(m) {
        return '\\' + m;
      });
    };
    recursive(cv, escape, _.isString);
    return cv;
  };
  var process = _.flow(processLocale, processDates, processURLs, processChars
    , escapeTeX);
  return process(cv);
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
  var writeFileContent = _.partial(writeFile, _, content);
  return pipe([ getTargetFile, writeFileContent ]);
};
writeTargetFile = _.partial(writeTargetFile, commander);

var renderTeX = function() {
  return pipe([ readSourceFile, processSourceFile, renderTargetFile
    , writeTargetFile, process.exit ]).catch(logError);
};

module.exports = { renderTeX: renderTeX };
