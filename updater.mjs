import {readFile, writeFile, mkdtemp, copyFile, rm, access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
export const RELEASE_PAGE = 'https://github.com/wang-qingfeng-dev/ielts-writing-studio/releases/latest';
const API = 'https://api.github.com/repos/wang-qingfeng-dev/ielts-writing-studio/releases/latest';
const ASSET_PREFIX = 'https://github.com/wang-qingfeng-dev/ielts-writing-studio/releases/download/';
export class UpdateError extends Error { constructor(message, status = 503) { super(message); this.status = status; } }
function versionParts(value) { return /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value) ? value.replace(/^v/, '').split('.').map(Number) : null; }
export function isNewerVersion(next, current) {
  const a = versionParts(next), b = versionParts(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) return a[i] > b[i]; }
  return false;
}
export function releaseUpdate(release, current) {
  if (release.draft || release.prerelease || !versionParts(release.tag_name)) throw new UpdateError('发行版本信息无效，请稍后重试。');
  const version = release.tag_name.replace(/^v/, '');
  const name = `ielts-writing-studio-v${version}-windows-x64-setup.exe`;
  const asset = release.assets?.find(item => item.name === name);
  if (!isNewerVersion(version, current)) return {available:false, version:current, latestVersion:version, releaseUrl:RELEASE_PAGE};
  if (!asset || asset.state !== 'uploaded' || !Number.isSafeInteger(asset.size) || asset.size < 1 || asset.size > 200 * 1024 * 1024 || !/^sha256:[a-f0-9]{64}$/.test(asset.digest || '') || asset.browser_download_url !== `${ASSET_PREFIX}v${version}/${name}`) {
    throw new UpdateError('新版安装包尚未准备完整或缺少校验值，请稍后重试。');
  }
  return {available:true, version:current, latestVersion:version, releaseUrl:RELEASE_PAGE, asset};
}
async function launchHelper({directory, installer, sha256, root, parentPid, port}) {
  const helper = path.join(directory, 'install-update.ps1');
  await copyFile(path.join(ROOT, 'scripts/updater/install-update.ps1'), helper);
  const args = ['-NoProfile','-ExecutionPolicy','Bypass','-File',helper,'-Installer',installer,'-ExpectedHash',sha256,'-AppRoot',root,'-ParentProcessId',String(parentPid),'-AppPort',String(port)];
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const child = spawn(powershell, args, {detached:true, windowsHide:true, stdio:'ignore', shell:false});
  await new Promise((resolve,reject) => { child.once('spawn',resolve); child.once('error',reject); });
  child.unref();
}
export function createUpdater({root=ROOT, platform=process.platform, arch=process.arch, fetchImpl=fetch, launch=launchHelper, tempRoot=os.tmpdir()} = {}) {
  let installing = false;
  async function installed() {
    if (platform !== 'win32' || arch !== 'x64') return false;
    try {
      await access(path.join(root, '.git')); return false;
    } catch { /* 源码仓库不能被安装器覆盖。 */ }
    try { return JSON.parse(await readFile(path.join(root, 'INSTALLATION.json'),'utf8')).kind === 'windows-installer'; } catch { return false; }
  }
  async function check() {
    const version = JSON.parse(await readFile(path.join(root,'package.json'),'utf8')).version;
    let response;
    try { response = await fetchImpl(API,{headers:{Accept:'application/vnd.github+json','User-Agent':'Jujin-Updater'}, signal:AbortSignal.timeout(20000), redirect:'error'}); }
    catch { throw new UpdateError('无法连接 GitHub，请检查网络后重试。当前版本仍可正常使用。'); }
    if (!response.ok) throw new UpdateError(response.status === 403 || response.status === 429 ? 'GitHub 暂时限制请求，请稍后再检查更新。' : '暂时无法读取最新版本，请稍后重试。');
    const result = releaseUpdate(await response.json(), version);
    return {...result, canInstall:await installed()};
  }
  return {
    check,
    async install({port}) {
      if (installing) throw new UpdateError('更新已在进行，请勿重复操作。',409);
      installing = true;
      let directory;
      try {
        if (!await installed()) throw new UpdateError('自动安装仅支持 Windows x64 安装版。请从发行页下载安装包。',400);
        const update = await check();
        if (!update.available) throw new UpdateError('当前已是最新版本。',409);
        const {asset} = update;
        directory = await mkdtemp(path.join(tempRoot,'jujin-update-'));
        // 下载地址与校验值只能来自固定官方仓库，前端不能传入地址或执行参数。
        const response = await fetchImpl(asset.browser_download_url,{signal:AbortSignal.timeout(300000)});
        if (!response.ok) throw new UpdateError('安装包下载失败，请检查网络后重试。');
        const chunks = []; let size = 0;
        for await (const chunk of response.body) {
          size += chunk.length;
          if (size > asset.size) throw new UpdateError('安装包大小不一致，已停止更新。');
          chunks.push(chunk);
        }
        const bytes = Buffer.concat(chunks);
        const sha256 = createHash('sha256').update(bytes).digest('hex');
        if (size !== asset.size || `sha256:${sha256}` !== asset.digest) throw new UpdateError('安装包校验失败，已停止更新；原有程序未改动。');
        const installer = path.join(directory, asset.name);
        await writeFile(installer, bytes, {flag:'wx'});
        await launch({directory,installer,sha256,root,parentPid:process.pid,port});
        return {version:update.latestVersion, restarting:true};
      } catch(error) {
        installing = false;
        if (directory) await rm(directory,{recursive:true,force:true}).catch(()=>{});
        if (error instanceof UpdateError) throw error;
        throw new UpdateError('更新未能启动，原有程序仍可使用。请重试或从发行页下载。');
      }
    }
  };
}
