/// <reference path="./typings/all.d.ts" />
var _ = require("lodash");
var json5 = require("json5");
var path = require("path");
var convertSourceMap = require("convert-source-map"); //https://www.npmjs.com/package/convert-source-map  used by browserify tsify
/** entrypoint accessed by grunt on execution.  here we load tasks and config them. */
function __entryPoint(grunt) {
    /** construct bones of the config file.  will be filled in by below functions */
    var config = {
        /** read npm package.json values, so values can be read by various grunt tasks. */
        pkg: grunt.file.readJSON("package.json"),
    };
    loadModules(grunt, config);
    loadOurTasks(grunt, config);
    //custom one-off watch for multiple files, taken from here: https://www.npmjs.com/package/grunt-contrib-watch
    var changedFiles = {};
    var onChange = _.debounce(function () {
        var files = Object.keys(changedFiles);
        changedFiles = {};
        onWatchUpdate(grunt, config, files);
    }, 200);
    grunt.event.on("watch", function (action, filepath, watchTaskName) {
        grunt.log.writeln(watchTaskName + ': ' + filepath + ' has ' + action);
        changedFiles[filepath] = { action: action, watchTaskName: watchTaskName };
        onChange();
    });
    grunt.initConfig(config);
    helpers.forceTaskHack(grunt);
    registerCustomTasks(grunt, config);
}
;
function loadModules(grunt, config) {
    {
    }
    /** allow file watch tasks*/
    function loadContribWatch() {
        grunt.loadNpmTasks("grunt-contrib-watch"); //do work on changed files
        _.merge(config, {
            watch: {}
        });
    }
    loadContribWatch();
    /** ts linter */
    function loadTsLint() {
        grunt.loadNpmTasks("grunt-tslint"); //linter on typescript save (used with watch)
        var tslintConfig = null;
        try {
            tslintConfig = json5.parse(grunt.file.read("tslint.json"));
        }
        catch (ex) {
            try {
                tslintConfig = json5.parse(grunt.file.read("../tslint.json"));
            }
            catch (ex) {
                tslintConfig = json5.parse(grunt.file.read("../../tslint.json"));
            }
        }
        _.merge(config, {
            tslint: {
                options: {
                    // Task-specific options go here.  see https://github.com/palantir/tslint
                    configuration: tslintConfig,
                },
                default: {
                    src: ["**/*.ts", "!**/node_modules/**"],
                },
            },
        });
    }
    loadTsLint();
    /** ts compiler */
    function loadTs() {
        grunt.loadNpmTasks("grunt-ts"); //compile typescript (used with watch)
        _.merge(config, {
            ts: {
                default: {
                    src: ["**/*.ts", "!**/*.d.ts", "!**/node_modules/**"],
                    options: {
                        module: "commonjs",
                        comments: true,
                        compiler: "./node_modules/typescript/bin/tsc",
                    },
                },
            },
        });
    }
    loadTs();
    /** autodoc for typescript */
    function loadTypeDoc() {
        grunt.loadNpmTasks("grunt-typedoc"); //autodoc typescript
        _.merge(config, {
            typedoc: {
                default: {
                    options: {
                        module: "commonjs",
                        out: "./docs",
                        name: "test-docs",
                        target: "es5",
                    },
                    src: ["**/*.ts", "!**/*.d.ts", "!**/node_modules*"],
                },
            },
        });
    }
    loadTypeDoc();
    /** update of tsd typings */
    function loadTsd() {
        grunt.loadNpmTasks("grunt-tsd"); //auto-update of tsd typings
        _.merge(config, {
            tsd: {
                default: {
                    options: {
                        // execute a command
                        command: 'reinstall',
                        //optional: always get from HEAD
                        latest: true,
                        // optional: specify config file
                        config: './tsd.json',
                        // experimental: options to pass to tsd.API
                        opts: {}
                    }
                }
            },
        });
    }
    loadTsd();
    /** delete files/folders */
    function loadContribClean() {
        //see: https://github.com/gruntjs/grunt-contrib-clean
        grunt.loadNpmTasks("grunt-contrib-clean"); //delete files/folders
        //_.merge(config, {
        //	clean: {
        //	}
        //});
    }
    loadContribClean();
    /** browserify */
    function loadBrowserify() {
        grunt.loadNpmTasks("grunt-browserify"); //hook browserify compiler
        _.merge(config, {
            browserify: {}
        });
    }
    //loadBrowserify();
    /** browserify ts files directly.  */ //TODO: fix/ensure works
    function loadBrowserifyTsify() {
        //import convertSourceMap = require("convert-source-map"); //https://www.npmjs.com/package/convert-source-map
        //no grunt task to load, this is a browserify plugin.
        _.merge(config, {
            browserify: {
                default: {
                    options: {
                        plugin: ["tsify"],
                        watch: true,
                        //banner: "", //DO NOT USE: causes source-mappings to be off by 1 line.
                        //keepAlive: true,
                        //preBundleCB: (b: BrowserifyObject) => { b.plugin("tsify"); },
                        postBundleCB: function (err, src, next) {
                            {
                                var files = grunt.config("browserify.default.files");
                                //console.log("keys= ", _.keys(files));
                                var bundlePath = path.normalize(_.keys(files)[0]);
                                var bundleDir = path.dirname(bundlePath); //"node-scratch/"
                                var bundleFile = path.basename(bundlePath);
                                //add "back dirs" equal to the bundleDir subdir depth, as our sourcemaps
                                var bundleDirCount = bundleDir.split(path.sep).length;
                                var pageBaseDirAdjust = new Array(bundleDirCount + 1).join(".." + path.sep);
                                //convert windows relative-path source maps to linux style (backslash to slash)
                                //logic inspired from https://github.com/smrq/gulp-fix-windows-source-maps/blob/master/index.js
                                var contents = src.toString();
                                var sourceMap = convertSourceMap.fromSource(contents);
                                var sources = sourceMap.getProperty("sources");
                                _.forEach(sources, function (value, index, collection) {
                                    var sourcePath = path.normalize(value);
                                    sourcePath = path.join(pageBaseDirAdjust, sourcePath);
                                    console.log("sourcePath=", sourcePath);
                                    sources[index] = sourcePath.replace(new RegExp("\\\\", "g"), "/");
                                });
                                sourceMap.setProperty("sources", sources);
                            }
                            {
                                //try removing the source content to force loading original
                                sourceMap.setProperty("sourcesContent", null);
                                var sourceMapPath = bundlePath + ".map";
                                grunt.file.write(sourceMapPath, sourceMap.toJSON());
                                //var modifiedContents = contents.replace(convertSourceMap.commentRegex, sourceMap.toComment());
                                var modifiedContents = contents.replace(convertSourceMap.commentRegex, "//# sourceMappingURL=" + path.basename(sourceMapPath));
                            }
                            var modifiedSrc = new Buffer(modifiedContents);
                            next(err, modifiedSrc);
                        },
                        browserifyOptions: {
                            debug: true,
                        },
                    },
                    files: {},
                },
            },
        });
    }
    //loadBrowserifyTsify();
    /** minifier */
    function loadUglify() {
        grunt.loadNpmTasks("grunt-contrib-uglify"); //minifier
        _.merge(config, {
            //     clean: { //see https://github.com/gruntjs/grunt-contrib-clean
            ////tsd:["./typings/tsd.d.ts"],
            //     },
            uglify: {
                default: {
                    options: {
                        mangle: false,
                        compress: {},
                        sourceMap: true,
                        sourceMapIn: null,
                        sourceMapRoot: null,
                        maxLineLen: 255,
                        ASCIIOnly: false,
                        preserveComments: false,
                        beautify: { beautify: true, },
                        banner: "/* uglify.options.banner: <%= pkg.name %> <%= grunt.template.today(\"isoDateTime\") %> */",
                    },
                    files: {}
                },
            },
        });
    }
    loadUglify();
    /** es6 to 5 transpiler: https://babeljs.io/docs/using-babel/ */
    function loadBabel() {
        //grunt.loadNpmTasks("load-grunt-tasks");
        require("load-grunt-tasks")(grunt);
        _.merge(config, {
            babel: {
                options: {
                    sourceMap: true,
                },
                default: {
                    files: {} // {"source":"dest"}
                }
            }
        });
        //set input/output for watch tasks.  see https://github.com/gruntjs/grunt-contrib-watch
        grunt.event.on("watch", function (action, filepath, watchTaskName) {
            var outPath = filepath + ".es5";
            var fileMap = {};
            fileMap[outPath] = filepath;
            grunt.config("babel.default.files", fileMap);
        });
    }
    loadBabel();
    function loadDtsBundle() {
        grunt.loadNpmTasks("grunt-dts-bundle");
        _.merge(config, {
            dts_bundle: {
                default: {
                    options: {
                        //name: "xlib2.d.ts",
                        //main: "dev/xlib.d.ts",
                        //externals: true,
                        name: config.pkg.name,
                        main: "index.d.ts",
                    }
                }
            }
        });
    }
    //loadDtsBundle();
    function loadDtsConcat() {
        grunt.loadNpmTasks("grunt-dts-concat");
        _.merge(config, {
            dts_concat: {
                default: {
                    options: {
                        name: "index-concat",
                        main: "index.d.ts",
                    }
                }
            }
        });
    }
    //loadDtsConcat();
}
;
function loadOurTasks(grunt, config) {
    _.merge(config, {
        //     clean: { //see https://github.com/gruntjs/grunt-contrib-clean
        ////tsd:["./typings/tsd.d.ts"],
        //     },
        watch: {
            tsConsolePipeline: {
                files: ["dev/**/*.ts", "!dev/**/*.d.ts"],
                tasks: ["ts", "tslint"],
                options: {
                    //if you need to dynamically modify your config, the spawn option must be disabled to keep the watch running under the same context.
                    spawn: false,
                },
            },
            tsVSPipeline: {
                files: ["dev/**/*.ts", "!dev/**/*.d.ts"],
                tasks: ["tslint"],
                options: {
                    //if you need to dynamically modify your config, the spawn option must be disabled to keep the watch running under the same context.
                    spawn: false,
                },
            },
            browserify: {
                files: ["dev/www_**/*.page.ts"],
                tasks: ["browserify:default", "uglify:default"],
                options: {
                    //if you need to dynamically modify your config, the spawn option must be disabled to keep the watch running under the same context.
                    spawn: false,
                }
            },
            jsPipeline: {
                files: ["dev/**/*.js", "*.js"],
                tasks: ["uglify:default"],
                options: {
                    spawn: false,
                    //debounceDelay: 500, //500 is the default
                    event: ["all"],
                    atBegin: false,
                }
            },
        },
    });
}
function onWatchUpdate(grunt, config, changedFiles) {
    grunt.config("ts.default.src", changedFiles);
    grunt.config("tslint.default.src", changedFiles);
    grunt.config("browserify.default.src", changedFiles);
    var uglifyMap = {};
    _.forEach(changedFiles, function (val) {
        uglifyMap[val + ".min"] = val;
    });
    grunt.config("uglify.default.files", uglifyMap);
}
function registerCustomTasks(grunt, config) {
    //grunt.registerTask("refresh-dependencies", ["clean:tsd", "tsd:refresh"]);
    grunt.registerTask("build-prod", ["tslint", "ts", "typedoc"]);
    grunt.registerTask("build-dev", ["force:on", "tslint", "force:restore", "ts", "typedoc"]);
}
var helpers;
(function (helpers) {
    /** allow toggling of the grunt --force option.
    usage:  grunt.registerTask('foo',['bar','force:on','baz','force:restore']);
     * from:  https://github.com/gruntjs/grunt/issues/810#issuecomment-27363230 */
    function forceTaskHack(grunt) {
        var previous_force_state = grunt.option("force");
        grunt.registerTask("force", "allow toggling of the grunt --force option.  usage: grunt.registerTask('foo',['bar','force:on','baz','force:restore']);", function (setting) {
            if (setting === "on") {
                grunt.option("force", true);
            }
            else if (setting === "off") {
                grunt.option("force", false);
            }
            else if (setting === "restore") {
                grunt.option("force", previous_force_state);
            }
        });
    }
    helpers.forceTaskHack = forceTaskHack;
})(helpers || (helpers = {}));
var __obsolete;
(function (__obsolete) {
    /** configuration to allow one-off multiwatch, taken from here: https://www.npmjs.com/package/grunt-contrib-watch */
    function loadCustomEvents() {
        ///** buffer of pending files to trigger watch events for.  clears out after every exec of .onChange() */
        //var changedFiles: _.Dictionary<string> = {};
        ///** listener-worker, executes 200ms after the last changed file */
        //var onChange = _.debounce(function (action: string, filepath: string, watchTaskName: string) {
        //	//see "Compiling Files As Needed" section of https://github.com/gruntjs/grunt-contrib-watch for details.
        //	var src: {} = grunt.config("tslint.default.src");
        //	src[0] = Object.keys(changedFiles);
        //	grunt.config("tslint.default.src", src);
        //	src = grunt.config("ts.default.src");
        //	src[0] = Object.keys(changedFiles);
        //	grunt.config("ts.default.src", src);
        //	var browserifyFiles: _.Dictionary<[string]> = {}
        //	var uglifyFiles: _.Dictionary<[string]> = {}
        //	_.forIn(changedFiles,(value, key, collection) => {
        //		var sourcePath = path.normalize(key);
        //		var sourceDir = path.dirname(sourcePath)
        //		var sourceFile = path.basename(sourcePath);
        //		var ext = path.extname(sourceFile);
        //		//var destFile = sourceFile.replace(ext, ".bundle.js");
        //		var bundlePath = sourcePath.replace(ext, ".bundle.js");
        //		var bundlePathSourceMap = bundlePath + ".map";
        //		browserifyFiles[bundlePath] = [sourcePath];
        //		//uglify
        //		ext = path.extname(bundlePath);
        //		var minBundlePath = bundlePath.replace(ext, ".min.js");
        //		uglifyFiles[minBundlePath] = [bundlePath];
        //		grunt.config("uglify.watch_target.options.sourceMapIn", bundlePathSourceMap);
        //		//console.log(destPath, sourceFile);
        //	});
        //	grunt.config("browserify.watch_target_ts.files", browserifyFiles);
        //	grunt.config("uglify.watch_target.files", uglifyFiles);
        //	//clear out our buffer
        //	changedFiles = {};
        //}, 200);
        //grunt.event.on("watch",(action: string, filepath: string, watchTaskName: string) => {
        //	changedFiles[filepath] = action;
        //	onChange(action, filepath, watchTaskName);
        //});
    }
})(__obsolete || (__obsolete = {}));
module.exports = __entryPoint;
