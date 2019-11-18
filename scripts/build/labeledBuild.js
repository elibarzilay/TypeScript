// @ts-check

const fs = require("fs");
const { spawnSync } = require("child_process");
const log = require("fancy-log");
const del = require("del");
const which = require("which");
const crypto = require("crypto");
const glob = require("glob");
const { series } = require("gulp");
const cmdLineOptions = require("./options");

const gitExe = which.sync("git", {nothrow: true});
const git = !gitExe ? (..._) => null
    : (...args) => spawnSync(gitExe, args, {encoding: "utf-8"}).stdout.trim();
const getGitBranch = () =>
    git("rev-parse", "--abbrev-ref", "HEAD") ||
    (() => { throw new Error("Cannot get branch name from \"git rev-parse\""); })();

const globHash = gl =>
    new Promise((res, rej) =>
        glob(gl, {dot: true, nodir: true},
             (err, files) => err ? rej(err)
             : Promise.all(files.map(file => new Promise((res, _rej) => {
                 const h = crypto.createHash("sha1");
                 const s = fs.createReadStream(file);
                 s.on("data", data => h.update(data));
                 s.on("end", () => res(h.digest("base64")));
             }))).then(hashes => {
                 const h = crypto.createHash("sha1");
                 hashes.forEach(hash => h.update(hash));
                 res(h.digest("base64"));
             })));

module.exports = localBuild => async function labeledBuild() {
    let label = cmdLineOptions.label.trim();
    const infoFile = "built/local/.build-info";
    const readInfo = () =>
        fs.existsSync(infoFile)
        ? JSON.parse(fs.readFileSync(infoFile, "utf-8"))
        : {label: "local", hash: null};
    const writeInfo = info =>
        info.label != "local" && fs.writeFileSync(infoFile, JSON.stringify(info));
    const labelToPath = label =>
        "built/--" + label.replace(/\//g, "--");
    let curInfo = readInfo();
    if (label == "") label = curInfo.label;
    else if (label == "git-branch") label = getGitBranch();
    if (!fs.existsSync("built")) fs.mkdirSync("built");
    if (label != curInfo.label) {
        if (fs.existsSync("built/local")) {
            const curLabelPath = labelToPath(curInfo ? curInfo.label : "local");
            if (fs.existsSync(curLabelPath)) {
                log(`warning: removing old label directory: ${curLabelPath}`);
                await del(curLabelPath);
            }
            log(`renaming built/local -> ${curLabelPath}`);
            fs.renameSync("built/local", curLabelPath);
        }
        const labelPath = labelToPath(label);
        if (!fs.existsSync(labelPath)) {
            fs.mkdirSync("built/local");
            curInfo = {label: label, hash: "0"};
        } else {
            log(`renaming ${labelPath} -> built/local`);
            fs.renameSync(labelPath, "built/local");
            curInfo = readInfo();
        }
    }
    const hash = label == "local" ? "" : await globHash("src/**/*");
    if (curInfo.hash == hash) return;
    writeInfo({label, hash: "0"}); // keep "0" if there's a build failure
    series(localBuild, async function saveBuildInfo() {
        curInfo.hash = hash;
        writeInfo({label, hash});
    })();
};
