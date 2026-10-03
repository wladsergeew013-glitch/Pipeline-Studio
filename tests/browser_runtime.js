'use strict';
const fs=require('fs'),path=require('path'),os=require('os');
let playwright;try{playwright=require('playwright');}catch{playwright=require(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));}
const edge='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const executablePath=process.env.STUDIO_CHROMIUM||(fs.existsSync(edge)?edge:null);
module.exports={playwright,launchOptions:{headless:true,...(executablePath?{executablePath}:{})}};
