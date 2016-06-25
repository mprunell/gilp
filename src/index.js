var File = require('vinyl');
var execSync = require('child_process').execSync;
var fs = require('fs');
var gulpFilter = require('gulp-filter');
var gulpIf = require('gulp-if');
var streamify = require('stream-array');
var stripBomBuf = require('strip-bom-buf');
var through2 = require('through2');
var util = require('util');
var path = require('path');
var yargs = require('yargs');

var hooks = [
  'pre-commit',
  'pre-push'
];

function Gilp (gulp) {
  var gilp = this;
  this._gulp = gulp;
  this._installed = [];
  this._gulp.task('gilp-install', function (callback) {
    fs.readFile(path.join(__dirname, '../templates/hook.js'), 'utf8', function (err, template) {
      if (err) {
        return callback(err);
      }
      var directory = path.join(gilp.getBaseDirectory(), '.git/hooks');
      var installed = gilp._installed.concat();
      var saveNext = function () {
        var hook = installed.shift();
        if (hook === undefined) {
          return callback();
        }
        var content = util.format(template, hook);
        var filepath = path.join(directory, hook);
        fs.writeFile(filepath, content, function (err) {
          if (err) {
            return callback(err);
          }
          fs.chmodSync(filepath, '700');
          saveNext();
        });
      };
      saveNext();
    });
  });
}

Gilp.prototype.hook = function (name, dep, fn) {
  if (hooks.indexOf(name) === -1) {
    throw new Error(util.format('Unsupported hook: %s', name));
  }

  if (!fn && typeof dep === 'function') {
    fn = dep;
    dep = undefined;
  }
  dep = dep || [];
  fn = fn || function () {};

  this._installed.push(name);
  this._gulp.task(util.format('gilp-%s', name), dep, fn);
};

Gilp.prototype.getBaseDirectory = function () {
  return execSync('git rev-parse --show-toplevel').toString().trim();
};

Gilp.prototype.getBranch = function () {
  return execSync('git rev-parse --abbrev-ref HEAD').toString().trim();
};

Gilp.prototype.getArgs = function () {
  return yargs.parse(yargs.argv.gilpArgs || []);
};

Gilp.prototype._getStream = function (objectFormat, paths, glob) {
  return streamify(paths)
    .pipe(through2.obj(function (path, enc, callback) {
      var contents = execSync(util.format('git cat-file blob %s', util.format(objectFormat, path)));
      var file = new File({
        gilp: true,
        path: path,
        contents: stripBomBuf(contents)
      });
      this.push(file);
      callback();
    }))
    .pipe(gulpIf(glob !== undefined, gulpFilter(glob || [])));
};

Gilp.prototype.srcFromStaged = function (glob) {
  return this._getStream(
    ':0:%s',
    execSync('git diff --cached --name-only --diff-filter=ACM')
      .toString()
      .trim()
      .split('\n'),
    glob
  );
};

Gilp.prototype.srcFromCommit = function (commit, glob) {
  return this._getStream(
    util.format('%s:%%s', commit),
    execSync(util.format('git diff --name-only --diff-filter=ACM %s^ %s', commit, commit))
      .toString()
      .trim()
      .split('\n'),
    glob
  );
};

module.exports = function (gulp) {
  return new Gilp(gulp);
};