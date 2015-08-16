'use strict';

var fs = require('fs-extra'),
    path = require('path'),
    _ = require('lodash'),
    Q = require('q');

var config = require('./config'),
    parse = require('./parse'),
    ask = require('./ask'),
    filter = require('./filter'),
    cache = require('./cache'),
    serialize = require('./serialize'),
    render = require('./render'),
    template = require('./template');

////////

var run = module.exports = {};

////////

run.init = function (initPathArg) {
  var initPath = path.resolve(initPathArg);
  var configFileName = 'config.js';
  var configPath = path.join(initPath, configFileName);
  var defaultsPath = './src/defaults';

  return Q.nfcall(fs.copy, defaultsPath, initPath).then(function () {
    return cache.set('useConfig', configPath);
  });
};


run.use = function (usePathArg) {
  var usePath = path.resolve(usePathArg);

  return Q.nfcall(fs.exists, usePath).then(function (exists) {
    if (!exists) {
      console.log('[tleaf]: Config file not found'); // TODO: throw?
      return;
    }
    return cache.set('useConfig', usePath);
  });
};


run.current = function () {
  return cache.get('useConfig').then(function (usePath) {
    if (!usePath) {
      console.log('[tleaf]: Using default config'); // TODO: log?
    } else {
      console.log('[tleaf]: Current config path: %s', usePath);
    }
  });
};


run.create = function (outputPathArg) {
  var outputPath = path.resolve(outputPathArg);
  var generateToPath = _.partial(generate, outputPath);

  return ask.createUnit().then(generateToPath);
};


run.parse = function (sourcePathArg, outputPathArg) {

  var sourcePath = path.resolve(sourcePathArg),
      outputPath = path.resolve(outputPathArg);

  if (!fs.existsSync(sourcePath)) {
    console.error('Source file not found');
    return false;
  }

  var source = fs.readFileSync(sourcePath, 'utf8');

  var units = parse(source);

  if (!units.length) {
    console.error('Could not find any units');
    return false;
  }

  var generateToPath = _.partial(generate, outputPath);

  if (units.length === 1) {
    return identify(_.first(units)).then(generateToPath);
  }

  return ask.pickUnit(units).then(identify).then(generateToPath);
};


////////


function identify(unit) {
  var deferred = Q.defer();

  var deps = filter(unit.deps, {
    exclude: config.filteredDependencies
  });

  if (!deps.unknown.length) {
    unit.deps = deps.known;
    deferred.resolve(unit);
    return deferred.promise;
  }

  return ask.identifyDeps(deps.unknown).then(function (identified) {
    unit.deps = deps.known.concat(identified);
    return unit;
  });
}

function sort(deps) {
  var copy = deps.slice();

  var order = config.processedProviders;

  copy.sort(function (depA, depB) {
    var indexA = order.indexOf(depA.type),
        indexB = order.indexOf(depB.type);
    if (indexA > indexB) { return 1; }
    if (indexA < indexB) { return -1; }
    return 0;
  });

  return copy;
}

function generate(outputPath, unit) {

  unit.deps = sort(unit.deps);

  var source = template.unit(unit.type);

  var data = serialize(unit);

  var partials = {};
  _.forEach(config.processedProviders, function (provider) {
    partials[provider] = template.provider(provider);
  });

  var output = render(source, data, {
    indent: config.indent,
    partials: partials
  });

  fs.writeFileSync(outputPath, output);
}