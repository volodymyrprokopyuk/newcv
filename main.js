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

locales.en = { typesetWith: 'Typeset with', profile: 'Profile'
  , education: 'Education', employment: 'Employment'
  , skills: 'Skills and Competencies'
};

locales.es = { typesetWith: 'Tipografía', profile: 'Perfil'
  , education: 'Formación', employment: 'Experiencia laboral'
  , skills: 'Habilidades y Competencias'
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

var getTargetFormat = function(opts) {
  var rFileExt = /\.(\w{3,4})$/;
  return opts.target && rFileExt.test(opts.target)
    ? opts.target.match(rFileExt)[1] : '';
};

var processTeX = function(cv) {
  var processTeXURLs = function(cv) {
    var counter = 0;
    var processTeXURL = function(str) {
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
    recursive(cv, processTeXURL, _.isString);
    return cv;
  };
  var processTeXMarkup = function(cv) {
    var processMarkup = function(str) {
      return str.replace(/ -- /, '~\\endash~')
        .replace(/ --- /, '~\\emdash~')
        .replace(/ConTeXt/, '\\CONTEXT');
    };
    recursive(cv, processMarkup, _.isString);
    return cv;
  };
  var escapeTeXChars = function(cv) {
    var escapeChars = function(str) {
      return str.replace(/[&%#_\$\{\}]/g, function(m) {
        return '\\' + m;
      });
    };
    recursive(cv, escapeChars, _.isString);
    return cv;
  };
  var process = _.flow(processTeXURLs, processTeXMarkup, escapeTeXChars);
  return process(cv);
};

var processTXT = function(cv) {
  return cv;
};

var processErr = function(cv) {
  return Promise.reject('no target file supplied');
};

var formats = { 'tex': processTeX, 'txt': processTXT, 'err': processErr };

var processSourceFile = function(processFormat, cv) {
  var hideContent = function(cv) {
    cv.education = _.reject(cv.education, 'hide');
    cv.employment = _.reject(cv.employment, 'hide');
    cv.skills = _.reject(cv.skills, 'hide');
    return cv;
  };
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
  var process = _.flow(hideContent, processLocale, processDates
    , processFormat);
  return process(cv);
};
processSourceFile = _.partial(processSourceFile
  , formats[getTargetFormat(commander) || 'err' ]);

var renderTargetFile = function(opts, cv) {
  var getTemplate = function() {
    var format = getTargetFormat(opts);
    return format + '/cv.' + format;
  };
  var renderCV = _.partial(render, _, cv);
  return pipe([ getTemplate, renderCV ]);
};
renderTargetFile = _.partial(renderTargetFile, commander);

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

var renderCV = function() {
  return pipe([ readSourceFile, processSourceFile, renderTargetFile
    , writeTargetFile, process.exit ]).catch(logError);
};

module.exports = { renderCV: renderCV };
