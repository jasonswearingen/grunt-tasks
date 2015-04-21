/// <reference path="./typings/all.d.ts" />

import _ = require("lodash");
import json5 = require("json5");
import path = require("path");


import convertSourceMap = require("convert-source-map"); //https://www.npmjs.com/package/convert-source-map  used by browserify tsify

/** entrypoint accessed by grunt on execution.  here we load tasks and config them. */
function __entryPoint(grunt: IGrunt) {
	/** construct bones of the config file.  will be filled in by below functions */
	var config = {		
		/** read npm package.json values, so values can be read by various grunt tasks. */
		pkg: grunt.file.readJSON("package.json"),
		
	};
	
	loadModules(grunt, config);

	loadOurTasks(grunt, config);

	//custom one-off watch for multiple files, taken from here: https://www.npmjs.com/package/grunt-contrib-watch

	var changedFiles: _.Dictionary<any> = {};
	var onChange = _.debounce(() => {
		var files = Object.keys(changedFiles);
		changedFiles = {};
		onWatchUpdate(grunt, config, files);
	}, 200);

	grunt.event.on("watch",(action: string, filepath: string, watchTaskName: string) => {
		grunt.log.writeln(watchTaskName + ': ' + filepath + ' has ' + action);
		changedFiles[filepath] =  { action:action, watchTaskName:watchTaskName };
		onChange();
	});


	grunt.initConfig(<any>config);

	helpers.forceTaskHack(grunt);

	registerCustomTasks(grunt, config);


};
/** export only our gruntfile entrypoint, as this is the format grunt expects*/
export = __entryPoint;


function loadModules(grunt: IGrunt, config: any) {
	{
		//function loadExample() {
		//	//first load up your task
		//	grunt.loadNpmTasks("npm-name-here");
		//	//then configure it
		//	_.merge(config, { some: "config stuff" }); 
		//	//then do any fancy code based configurations here

		//	grunt.event.on("watch",(action: string, filepath: string, watchTaskName: string) => {
		//		changedFiles[filepath] = action;
		//		//do stuff here
		//	});
		//}
		//loadExample();
	}
	/** allow file watch tasks*/
	function loadContribWatch() {
		grunt.loadNpmTasks("grunt-contrib-watch"); //do work on changed files
		_.merge(config, {
			watch: {
				//cwd: process.cwd() + "/dev";
			}
		});
	}
	loadContribWatch();


	/** ts linter */
	function loadTsLint() {
		grunt.loadNpmTasks("grunt-tslint"); //linter on typescript save (used with watch)
		var tslintConfig: any = null;

		try {
			tslintConfig = json5.parse(grunt.file.read("tslint.json"));
		} catch (ex) {
			try {
				tslintConfig = json5.parse(grunt.file.read("../tslint.json"));
			} catch (ex) {
				tslintConfig = json5.parse(grunt.file.read("../../tslint.json"));
			}
		}
		_.merge(config, {

			tslint: { //see https://www.npmjs.com/package/grunt-tslint
			
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
			ts: { //see https://www.npmjs.com/package/grunt-ts
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

			typedoc: { //see https://www.npmjs.com/package/grunt-typedoc
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

			tsd: { //see https://www.npmjs.com/package/grunt-tsd
				default: {
					options: {
						// execute a command
						command: 'reinstall',

						//optional: always get from HEAD
						latest: true,

						// optional: specify config file
						config: './tsd.json',

						// experimental: options to pass to tsd.API
						opts: {
							// props from tsd.Options
						}
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

	/** browserify ts files directly.  */  //TODO: fix/ensure works
	function loadBrowserifyTsify() {
		//import convertSourceMap = require("convert-source-map"); //https://www.npmjs.com/package/convert-source-map
		//no grunt task to load, this is a browserify plugin.
		_.merge(config, {
			browserify: {
				default: {
					options: {
						plugin: ["tsify"],
						watch: true, //in BUILD runs, set this to false to avoid full path in bundle.  see https://github.com/jmreidy/grunt-browserify/issues/245
						//banner: "", //DO NOT USE: causes source-mappings to be off by 1 line.
						//keepAlive: true,
						//preBundleCB: (b: BrowserifyObject) => { b.plugin("tsify"); },
						postBundleCB: (err: string, src: Buffer, next: (err: string, modifiedSrc: Buffer) => void) => {

							//fixup sourcemaps:  convert windows backslash dir seperators into unix style (chrome only supports unix)
							//and adjust the bundled script folder to be the same as the webpage (by default browserify assumes page is in the grunt root/baseDir cwd)
							{
								var files: _.Dictionary<string> = grunt.config("browserify.default.files");
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

								var sources: string[] = sourceMap.getProperty("sources");

								_.forEach(sources,(value, index, collection) => {
									var sourcePath = path.normalize(value);
									sourcePath = path.join(pageBaseDirAdjust, sourcePath);
									console.log("sourcePath=", sourcePath);
									sources[index] = sourcePath.replace(new RegExp("\\\\", "g"), "/");
								});
								sourceMap.setProperty("sources", sources);
							}

							//clean up the sourcemap and extract it to it's own file for uglify use
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
					files: {
						//"./node-scratch/main.page.bundle.js": ["./node-scratch/main.page.ts"],
					},
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
		


			uglify: { //see https://www.npmjs.com/package/grunt-contrib-uglify

				default: {
					options: {
						mangle: false, //don't need, use gzip compression.  can use this for obfuscation purposes in production build.
						compress: {
							//dead_code: true,							
						},

						sourceMap: true,
						sourceMapIn: null,
						sourceMapRoot: null, //set base path for sourcemap sources.
						maxLineLen: 255,
						ASCIIOnly: false,
						preserveComments: false,
						beautify: { beautify: true, },
						banner: "/* uglify.options.banner: <%= pkg.name %> <%= grunt.template.today(\"isoDateTime\") %> */", //yyyy-mm-ddtHH:mm:ss
						//footer: "/* uglify.options.footer */", //CAN NOT USE FOOTER!, messes up source mappings
					},
					files: {
						//'dest/output.min.js': ['src/input.js'],
						//src: "**/*.js",
						//dest:"",
					}

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
					sourceMap: true, //"inline",
					//comments: false,
					//inputExtension:".js",
					//outputExtension: ".es5", //our custom hack
				},
				default: {
					files: {}// {"source":"dest"}
				}
			}
		});
		//set input/output for watch tasks.  see https://github.com/gruntjs/grunt-contrib-watch
		grunt.event.on("watch",(action: string, filepath: string, watchTaskName: string) => {
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
						//name: "xlib2",
						//main: "dev/xlib.d.ts",
					}
				}
			}
		});
	}
	//loadDtsConcat();
};

function loadOurTasks(grunt: IGrunt, config: any) {

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
				files: ["dev/www_**/*.page.ts"], //["node-scratch/*.page.ts", "!**/node_modules/**"],
				tasks: ["browserify:default", "uglify:default"],
				options: {
					//if you need to dynamically modify your config, the spawn option must be disabled to keep the watch running under the same context.
					spawn: false,
				}

			},
			jsPipeline: {
				files: ["dev/**/*.js", "*.js"], //, "!**/node_modules/**", "!**/.git"],
				tasks: ["uglify:default"],
				options: {	//options here: https://www.npmjs.com/package/grunt-contrib-watch						
					spawn: false, //if you need to dynamically modify your config, the spawn option must be disabled to keep the watch running under the same context.
					//debounceDelay: 500, //500 is the default
					event: ["all"], //all,changed,added,deleted
					atBegin: false, //the default.  set to true to run the task for all files at startup
				}
			},
		},
	});


}

function onWatchUpdate(grunt: IGrunt, config: any, changedFiles: string[]) {
	grunt.config("ts.default.src", changedFiles);
	grunt.config("tslint.default.src", changedFiles);
	grunt.config("browserify.default.src", changedFiles);

	var uglifyMap = {};
	_.forEach(changedFiles,(val) => { uglifyMap[val + ".min"] = val; });
	grunt.config("uglify.default.files", uglifyMap);
}

function registerCustomTasks(grunt: IGrunt, config: any) {
	//grunt.registerTask("refresh-dependencies", ["clean:tsd", "tsd:refresh"]);
	grunt.registerTask("build-prod", ["tslint", "ts", "typedoc"]);
	grunt.registerTask("build-dev", ["force:on", "tslint", "force:restore", "ts", "typedoc"]);
}

module helpers{

	/** allow toggling of the grunt --force option.  
	usage:  grunt.registerTask('foo',['bar','force:on','baz','force:restore']);
	 * from:  https://github.com/gruntjs/grunt/issues/810#issuecomment-27363230 */
	export function forceTaskHack(grunt:IGrunt) {
		var previous_force_state = grunt.option("force");

		grunt.registerTask("force", "allow toggling of the grunt --force option.  usage: grunt.registerTask('foo',['bar','force:on','baz','force:restore']);",(setting) => {
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
}

module __obsolete{
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
}