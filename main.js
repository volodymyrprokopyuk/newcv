var format = require('util').format;
var fs = require('fs');
var moment = require('moment');
var _ = require('lodash');
var Promise = require('bluebird');
var commander = require('commander');
var nunjucks = require('nunjucks');
var jade = require('jade');

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
  , target: 'Target', requires: 'Company Requires', offer: 'I Offer'
  , education: 'Education', employment: 'Employment'
  , skills: 'Skills and Competencies'
};

locales.es = { typesetWith: 'Tipografía', profile: 'Perfil'
  , target: 'Propósito específico', requires: 'Empresa requiere'
  , offer: 'Yo ofrezco', education: 'Formación'
  , employment: 'Experiencia laboral'
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
      return str.replace(/ \| /g, '~$\\vert$~')
        .replace(/ -- /g, '~\\endash~')
        .replace(/ --- /g, '~\\emdash~')
        .replace(/ConTeXt/g, '\\CONTEXT');
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
  var process = _.flow(processTeXURLs, escapeTeXChars, processTeXMarkup);
  return process(cv);
};

var processTXT = function(cv) {
  var splitBy = function(length, str) {
    var aggLines = function(lines, word) {
      var lastLine = _.last(lines);
      (_.size(lastLine) + _.size(word) + 1 > length)
        && (lines.push(''), lastLine = _.last(lines));
      lines[_.size(lines) - 1] += (_.size(lastLine) ? ' ' : '') + word;
      return lines;
    };
    return _.reduce(str.split(' '), aggLines, [ '' ]);
  };
  var indentTo = function(indent, lines) {
    return lines.join('\n' + _.repeat(' ', indent));
  };
  var indent = function(indent, length, str) {
    return indentTo(indent, splitBy(length, str));
  };
  var flush = function(length, str) {
    var padLeft = _.partial(_.padLeft, _, length, ' ');
    return _.chain(splitBy(length, str)).map(padLeft).value().join('\n');
  };
  var mixinCV = function(cv) {
    cv.indent = indent;
    cv.flush = flush;
    cv.repeat = _.repeat;
    return cv;
  };
  var processTXTURLs = function(cv) {
    var processTXTURL = function(str) {
      return str.replace(/\[([^\]]+)\]\(([^\)]+)\)/g
        , function(markup, name, url) {
        return name;
      });
    };
    recursive(cv, processTXTURL, _.isString);
    return cv;
  };
  var processTXTMarkup = function(cv) {
    var processMarkup = function(str) {
      return str.replace(/~/g, ' ');
    };
    recursive(cv, processMarkup, _.isString);
    return cv;
  };
  var process = _.flow(mixinCV, processTXTURLs, processTXTMarkup);
  return process(cv);
};

var processHTML = function(cv) {
  var processHTMLURLs = function(cv) {
    var processHTMLURL = function(str) {
      return str.replace(/\[([^\]]+)\]\(([^\)]+)\)/g
        , function(markup, name, url) {
        return format('<a href="%s">%s</a>', url, name);
      });
    };
    cv.urls = [ ];
    recursive(cv, processHTMLURL, _.isString);
    return cv;
  };
  var processHTMLMarkup = function(cv) {
    var processMarkup = function(str) {
      return str.replace(/~/g, '&nbsp;')
        .replace(/ -- /g, ' &ndash; ')
        .replace(/ --- /g, ' &mdash; ');
    };
    recursive(cv, processMarkup, _.isString);
    return cv;
  };
  var process = _.flow(processHTMLURLs, processHTMLMarkup);
  return process(cv);
};

var processErr = function(cv) {
  return Promise.reject('no target file supplied');
};

var formats = { 'tex': processTeX, 'txt': processTXT, 'html': processHTML
  , 'err': processErr };

var processSourceFile = function(format, processFormat, cv) {
  var showContent = function(cv) {
    var show = function(item) {
      return _.size(item.show)
        && new RegExp('all|' + format).test(item.show);
    };
    cv.targets = _.filter(cv.targets, show);
    cv.target = _.size(cv.targets) ? _.first(cv.targets) : null;
    return cv;
  };
  var hideContent = function(cv) {
    var hide = function(item) {
      return _.size(item.hide)
        && new RegExp('all|' + format).test(item.hide);
    };
    cv.education = _.reject(cv.education, hide);
    cv.employment = _.reject(cv.employment, hide);
    cv.skills = _.reject(cv.skills, hide);
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
  var process = _.flow(showContent, hideContent, processLocale, processDates
    , processFormat);
  return process(cv);
};
processSourceFile = _.partial(processSourceFile, getTargetFormat(commander)
  , formats[getTargetFormat(commander) || 'err' ]);

var renderTargetFile = function(opts, cv) {
  var getTemplate = function() {
    var format = getTargetFormat(opts);
    return format + '/cv.' + format;
  };
  var renderCV = (getTargetFormat(opts) === 'html')
    ? _.partial(jade.renderFile, _, _.merge(cv, { pretty: true }))
    : _.partial(render, _, cv);
  return pipe([ getTemplate, renderCV ]);
};
renderTargetFile = _.partial(renderTargetFile, commander);

var writeTargetFile = function(opts, content) {
  content = content.replace(/ +$/mg, '');
  (getTargetFormat(opts) === 'txt')
    && (content = content.replace(/\n/g, '\r\n'));
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
