'use strict';
const {contextBridge,ipcRenderer}=require('electron');
if(process.isMainFrame)contextBridge.exposeInMainWorld('STUDIO_DESKTOP',{platform:process.platform,call:(route,data={})=>ipcRenderer.invoke('studio:file',route,data)});
