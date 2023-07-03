#!/usr/bin/env node
//jshint -W083
const conf = require('rc')('tinit')
const fs = require('fs')
const {readdir, stat, chmod, exists} = require('fs/promises')
const {join, parse, relative} = require('path')
const {mkdirp} = require('mkdirp')
const loner = require('loner')
const {rimraf} = require('rimraf')
const Git = require('./git')

async function main() {
  const SDK = process.env.TISL_SDK
  const VERSION = process.env.TISL_SDKVERSION
  if (!SDK || !VERSION) bail(new Error('Please use "source <(tisl env SDK_VERSION) to select an SDK'))

  if (conf._[0] == 'ls') {
    return listExamples(conf)
  }

  if (conf._.length !== 2) {
    usage()
    return bail(new Error('Not enough arguments'))
  }

  let [src, dest] = conf._
  const parsedSrc = parse(src)
  const exampleName = parsedSrc.base
  const exampleDir = parsedSrc.dir
  src = `${SDK}/examples/rtos/${process.env.BOARDNAME}/${exampleDir}/${exampleName}`
  if (!fs.existsSync(src)) return bail(new Error(`${src} does not exist.`))

  const parsedDest = parse(dest)
  const newname = parsedDest.base
  if (!newname.match(/^[a-zA-Z0-9_]+$/)) {
    return bail(new Error(`project name must be a valid C identifier.`))
  }

  console.log(`Copying ${src} to ${dest}`)

  const git = Git(dest)
  await findFiles(src, {action: copyFilesTo(join(dest, 'app'))})
  let lines = await git.init()
  if (!lines[0].startsWith('Initialized')) {
    console.error(lines)
    process.exit(1)
  }
  await git.add('.')
  const prettySrcPath = relative(parse(SDK).dir, src)
  await git.commit(`Verbatim copy from ${prettySrcPath} to app/`)

  if (VERSION < '5.30.01.00') {
    await findFiles(join(SDK, 'kernel'), {action: copyFilesTo(join(dest, 'kernel'))})
    await git.add('kernel')
    await git.commit(`Add kernel from SDK`)
  }

  await rimraf(join(dest, 'app'))
  await findFiles(src, {oldname: exampleName, newname, action: copyFilesTo(join(dest, 'app'))})
  await git.add('.')
  await git.commit(`Rename files to match new application name "${newname}"`)

  await findFiles(src, {replace: {find: exampleName, replaceWith: newname}, oldname: exampleName, newname, action: copyFilesTo(join(dest, 'app'))})
  await git.add('.')
  await git.commit(`Search and replace in files (risky!). "${exampleName}" becomes "${newname}"`)

  await copyFile(join(SDK, 'imports.mak'), join(dest, 'imports.mak'))
  await copyFile(join(__dirname, 'make.sh'), join(dest, 'make.sh'), {
    replace: [
      {find: '__SDKVERSION__', replaceWith: VERSION},
      {find: '__COMPILER__', replaceWith: VERSION < '5.30.01.00' ? 'ccs' : 'ticlang'},
    ]
  })
  await chmod(join(dest, 'make.sh'), 0774)
  await git.add(['imports.mak', 'make.sh'])
  await git.commit('Add imports.mak from SDK root and make.sh')
}

main()

// -- util

async function listExamples(opts) {
  opts = opts || {}
  const collections = 'boardname rtos compiler'.split(' ')
  const depth = 8
  const src = `${process.env.TISL_SDK}/examples`
  const list = await findFiles(src, {depth})
  const paths = list.flat(depth).map( ({src})=>src.split('/').slice(-depth))
  let examples = paths.filter(ps=>ps.slice(-1)[0].toLowerCase() == 'makefile' && ps[0] == 'examples')
  examples = examples.map(ex=>{
    const [x0,x1,boardname,category,name,rtos,compiler] = ex
    return {boardname, category, name, rtos, compiler}
  })
  examples = examples.reduce( (acc, ex)=>{
    const key = `${ex.category}/${ex.name}`
    const a = acc[key] = acc[key] || {}
    for(const c of collections) {
      a[c] = a[c] || []
      if (!a[c].includes(ex[c])) a[c].push(ex[c])
    }
    return acc
  }, {})
  examples = Object.fromEntries(Object.entries(examples).filter( ([k,ex]) =>{
    for(const c of collections) {
      if (opts[c]) {
        if (!ex[c].find(x=>x.indexOf(opts[c]) !== -1)) {
          return false
        }
      }
    }
    return true
  }))
  for (const name of Object.keys(examples).sort()) {
    const o = Object.assign({}, examples[name], opts)
    const o2 = Object.fromEntries(collections.map(c=>{
      return [c, Array.isArray(o[c]) ? o[c].join(' ') : `filterd: ${o[c]}`]
    }))
    console.log(`${name} [${o2.boardname}] (${o2.rtos}) {${o2.compiler}}`)
  }
}

function copyFilesTo(dest) {
  return async function(p, opts) {
    const {root} = opts
    const relpath = relative(root, p)
    const destname = join(dest, processName(relpath, opts))
    const {dir} = parse(destname)
    await mkdirp(dir) 
    return copyFile(p, destname, opts)
  }
}

async function findFiles(src, opts) {
  opts = opts || {}
  if (!opts.root) opts.root = src
  const {action} = opts
  const files = await readdir(src)
  return Promise.all(files.map(async file=>{
    const p = join(src, file)
    const s = await stat(p)
    if (s.isDirectory()) {
      if (opts.depth == undefined || opts.depth > 0) {
        const newOpts = opts.depth ? Object.assign({}, opts, {depth: opts.depth - 1}) : opts
        return findFiles(p, newOpts)
      }
    }
    if (action) return action(p, opts)
    return Promise.resolve({src: p})
  }))
}


function copyFile(p, destname, opts) {
  opts = opts || {}

  return new Promise( (resolve, reject)=>{
    const ws = fs.createWriteStream(destname)
    let rs
    if (opts.replace) {
      const r = ary(opts.replace)
      const seqs = r.map(({find})=>find)
      rs = fs.createReadStream(p).pipe(loner.apply(null, seqs))
        .on('data', data=>{
          const found = r.find(({find})=>data == find)
          if (found) data = found.replaceWith
          process.stdout.write('(r)')
          ws.write(data)
        })
    } else {
      rs = fs.createReadStream(p).pipe(ws)
    }
    rs.on('error', reject)
      .on('close', ()=>{
        ws.close()
        resolve({src: p, dest: destname})
      })

  })
}

function processName(name, opts) {
  const {oldname, newname} = opts
  if (!oldname || !newname) return name
  return name.replace(new RegExp(opts.oldname, 'g'), opts.newname)
}

function usage() {
  console.log(`tinit EXAMPLEDIR/EXAMPLENAME NEWNAME`)
  console.log(`tinit ls`) 
}

function bail(err) {
  if (!err) return
  console.error(err.message)
  process.exit(1)
}

function ary(x) {
  if (Array.isArray(x)) return x
  return [x]
}
