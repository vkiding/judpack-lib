/**
 * Created by budao on 2016/12/9.
 */
/*
 Licensed to the Apache Software Foundation (ASF) under one
 or more contributor license agreements.  See the NOTICE file
 distributed with this work for additional information
 regarding copyright ownership.  The ASF licenses this file
 to you under the Apache License, Version 2.0 (the
 "License"); you may not use this file except in compliance
 with the License.  You may obtain a copy of the License at

 http://www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing,
 software distributed under the License is distributed on an
 "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 KIND, either express or implied.  See the License for the
 specific language governing permissions and limitations
 under the License.
 */

var Q = require('q');
var fs = require('fs');
var path = require('path');
var shell = require('shelljs');
var events = require('judpack-common').events;
var CordovaError = require('judpack-common').CordovaError;
var isAndroidStudioProject;

function AndroidStudioBuilder(projectDir) {
  this.root = projectDir || path.resolve(__dirname, '../../..');
  isAndroidStudioProject =  require('../AndroidStudio').isAndroidStudioProject(this.root);
  this.mainAppDirs = isAndroidStudioProject ? path.join(this.root, 'app') : this.root;
  this.judpluginDirs = isAndroidStudioProject ? path.join(this.root, 'judplugin') : this.root;
  this.binDirs = {
    ant: path.join(this.mainAppDirs, hasCustomRules(this.root) ? 'ant-build' : 'bin'),
    gradle: path.join(this.mainAppDirs, 'build', 'outputs', 'apk')
  };
}

function hasCustomRules(projectRoot) {
  return fs.existsSync(path.join(projectRoot, 'custom_rules.xml'));
}

AndroidStudioBuilder.prototype.prepEnv = function() {
  return Q();
};

AndroidStudioBuilder.prototype.build = function() {
  events.emit('log', 'Skipping build...');
  return Q(null);
};

AndroidStudioBuilder.prototype.clean = function() {
  return Q();
};

AndroidStudioBuilder.prototype.findOutputApks = function(build_type, arch) {
  var self = this;
  return Object.keys(this.binDirs)
    .reduce(function (result, builderName) {
      var binDir = self.binDirs[builderName];
      return result.concat(findOutputApksHelper(binDir, build_type, builderName === 'ant' ? null : arch));
    }, [])
    .sort(apkSorter);
};

AndroidStudioBuilder.prototype.readProjectProperties = function () {
  function findAllUniq(data, r) {
    var s = {};
    var m;
    while ((m = r.exec(data))) {
      s[m[1]] = 1;
    }
    return Object.keys(s);
  }

  // JUD_HOOK_START
  var data = {};
  if (fs.existsSync(path.join(this.root, 'project.properties'))) {
    data = fs.readFileSync(path.join(this.root, 'project.properties'), 'utf8');
    console.log("JUDPACK", "data" + data);
  }
  // JUD_HOOK_END
  return {
    libs: findAllUniq(data, /^\s*android\.library\.reference\.\d+=(.*)(?:\s|$)/mg),
    gradleIncludes: findAllUniq(data, /^\s*cordova\.gradle\.include\.\d+=(.*)(?:\s|$)/mg),
    systemLibs: findAllUniq(data, /^\s*cordova\.system\.library\.\d+=(.*)(?:\s|$)/mg)
  };
};

AndroidStudioBuilder.prototype.extractRealProjectNameFromManifest = function () {
  var manifestPath = isAndroidStudioProject ? path.join(this.mainAppDirs, 'src', 'main', 'AndroidManifest.xml') : path.join(this.mainAppDirs, 'AndroidManifest.xml');
  var manifestData = fs.readFileSync(manifestPath, 'utf8');
  var m = /<manifest[\s\S]*?package\s*=\s*"(.*?)"/i.exec(manifestData);
  if (!m) {
    throw new CordovaError('Could not find package name in ' + manifestPath);
  }

  var packageName = m[1];
  var lastDotIndex = packageName.lastIndexOf('.');
  return packageName.substring(lastDotIndex + 1);
};

module.exports = AndroidStudioBuilder;

function apkSorter(fileA, fileB) {
  // De-prioritize unsigned builds
  var unsignedRE = /-unsigned/;
  if (unsignedRE.exec(fileA)) {
    return 1;
  } else if (unsignedRE.exec(fileB)) {
    return -1;
  }

  var timeDiff = fs.statSync(fileA).mtime - fs.statSync(fileB).mtime;
  return timeDiff === 0 ? fileA.length - fileB.length : timeDiff;
}

function findOutputApksHelper(dir, build_type, arch) {
  var shellSilent = shell.config.silent;
  shell.config.silent = true;

  var ret = shell.ls(path.join(dir, '*.apk'))
    .filter(function(candidate) {
      var apkName = path.basename(candidate);
      // Need to choose between release and debug .apk.
      if (build_type === 'debug') {
        return /-debug/.exec(apkName) && !/-unaligned|-unsigned/.exec(apkName);
      }
      if (build_type === 'release') {
        return /-release/.exec(apkName) && !/-unaligned/.exec(apkName);
      }
      return true;
    })
    .sort(apkSorter);

  shellSilent = shellSilent;

  if (ret.length === 0) {
    return ret;
  }
  // Assume arch-specific build if newest apk has -x86 or -arm.
  var archSpecific = !!/-x86|-arm/.exec(path.basename(ret[0]));
  // And show only arch-specific ones (or non-arch-specific)
  ret = ret.filter(function(p) {
    /*jshint -W018 */
    return !!/-x86|-arm/.exec(path.basename(p)) == archSpecific;
    /*jshint +W018 */
  });

  if (archSpecific && ret.length > 1 && arch) {
    ret = ret.filter(function(p) {
      return path.basename(p).indexOf('-' + arch) != -1;
    });
  }

  return ret;
}
