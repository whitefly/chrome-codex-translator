import {build, context} from 'esbuild';
import {cp, mkdir, readFile, readdir, rm} from 'node:fs/promises';
import {watch} from 'node:fs';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = path.join(root, 'dist');
const assets = path.join(root, 'extension');
const watching = process.argv.includes('--watch');
const manifest = JSON.parse(await readFile(path.join(assets, 'manifest.json'), 'utf8'));
const common = {absWorkingDir: root, bundle: true, platform: 'browser',
    target: `chrome${manifest.minimum_chrome_version}`, sourcemap: true, logLevel: 'info',
    legalComments: 'eof', outdir: output};
const builds = [
    {...common, entryPoints: {background: 'src/entries/background.ts', sidepanel: 'src/entries/sidepanel.ts'}, format: 'esm'},
    {...common, entryPoints: {hover: 'src/entries/hover.ts', content: 'src/entries/content.ts'}, format: 'iife'}
];

await rm(output, {recursive: true, force: true});
await mkdir(output, {recursive: true});
await cp(assets, output, {recursive: true});
await mkdir(path.join(output, 'licenses'), {recursive: true});
await cp(path.join(root, 'node_modules/marked/LICENSE'), path.join(output, 'licenses/marked.LICENSE'));

if (!watching) {
    await Promise.all(builds.map(options => build(options)));
} else {
    const contexts = await Promise.all(builds.map(options => context(options)));
    await Promise.all(contexts.map(builder => builder.watch()));
    // 静态文件与源码一起监听，删除资源时同步清理对应产物。
    let sync = Promise.resolve();
    let copied = new Set(await readdir(assets, {recursive: true}));
    const watcher = watch(assets, {recursive: true}, () => {
        sync = sync.then(async () => {
            const next = new Set(await readdir(assets, {recursive: true}));
            for (const name of copied) if (!next.has(name)) await rm(path.join(output, name), {recursive: true, force: true});
            await cp(assets, output, {recursive: true});
            copied = next;
        }).catch(error => console.error('静态资源同步失败:', error));
    });
    // 独立进程组包含 tsc 启动器及原生编译器，退出时一起释放。
    const checker = spawn(path.join(root, 'node_modules/.bin/tsc'), ['--noEmit', '--watch', '--preserveWatchOutput'],
        {cwd: root, stdio: 'inherit', detached: true});
    let stopping = false;
    async function stop(code = 0) {
        if (stopping) return;
        stopping = true;
        watcher.close();
        if (checker.pid && checker.exitCode === null) process.kill(-checker.pid, 'SIGTERM');
        await sync;
        await Promise.all(contexts.map(builder => builder.dispose()));
        process.exit(code);
    }
    watcher.on('error', error => { console.error('静态资源监听失败:', error); void stop(1); });
    checker.on('error', error => { console.error('类型检查启动失败:', error); void stop(1); });
    checker.on('exit', code => { if (!stopping) void stop(code ?? 1); });
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void stop(); });
}
