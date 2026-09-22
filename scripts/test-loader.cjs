const ts=require('typescript'),fs=require('fs'),path=require('path');
require.extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true,jsx:ts.JsxEmit.ReactJSX}}).outputText,file);
const Module=require('module'),original=Module._resolveFilename;
Module._resolveFilename=function(name,...args){if(name.startsWith('@/')) name=path.join(process.cwd(),name.slice(2));return original.call(this,name,...args)};

require.extensions[".tsx"]=require.extensions[".ts"];
