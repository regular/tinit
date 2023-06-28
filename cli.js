#!/usr/bin/env node
//jshint -W083
const conf = require('rc')('tinit')
const fs = require('fs')
const {readdir, stat} = require('fs/promises')
const {join, parse, relative} = require('path')
const {mkdirp} = require('mkdirp')
const loner = require('loner')
const {rimraf} = require('rimraf')
const Git = require('./git')

async function main() {
  const SDK = process.env.TISL_SDK
  if (!SDK) bail(new Error('Please use "source <(tisl env SDK_VERSION) to select an SDK'))

  if (conf._[0] == 'ls') {
    return listExamples(conf)
  }

  if (conf._.length !== 2) {
    usage()
    bail(new Error('Not enough arguments'))
  }

  const [src, newname] = conf._
  const {base, dir} = parse(src)
  const source = `${SDK}/examples/rtos/${process.env.BOARDNAME}/${dir}/${base}`
  const dest = newname

  console.log(`Copying ${source} to ${dest}`)

  const git = Git(dest)
  await findFiles(source, {action: copyFilesTo(join(dest, 'app'))})
  let lines = await git.init()
  if (!lines[0].startsWith('Initialized')) {
    console.error(lines)
    process.exit(1)
  }
  await git.add('.')
  const prettySrcPath = relative(parse(SDK).dir, source)
  await git.commit(`Verbatim copy from ${prettySrcPath} to app/`)

  // TODO: only for 5.00
  await findFiles(join(SDK, 'kernel'), {action: copyFilesTo(join(dest, 'kernel'))})
  await git.add('kernel')
  await git.commit(`Add kernel from SDK`)

  await rimraf(join(dest, 'app'))
  await findFiles(source, {oldname: base, newname, action: copyFilesTo(join(dest, 'app'))})
  await git.add('.')
  await git.commit(`Rename files to match new application name "${newname}"`)

  await findFiles(source, {replace: {find: base, replaceWith: newname}, oldname: base, newname, action: copyFilesTo(join(dest, 'app'))})
  await git.add('.')
  await git.commit(`Search and replace in files (risky!). "${base}" becomes "${newname}"`)

  await copyFile(join(SDK, 'imports.mak'), join(dest, 'imports.mak'))
  await copyFile(join(__dirname, 'make.sh'), join(dest, 'make.sh'))
  await git.add(['imports.mak', 'make.sh'])
  await git.commit('Add imports.mak from SDK root and make.sh')
}

main()

// -- util

async function listExamples(opts) {
  opts = opts || {}
  const collections = 'boardname rtos compiler'.split(' ')
  const depth = 8
  const source = `${process.env.TISL_SDK}/examples`
  const list = await findFiles(source, {depth})
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

async function findFiles(source, opts) {
  opts = opts || {}
  if (!opts.root) opts.root = source
  const {action} = opts
  const files = await readdir(source)
  return Promise.all(files.map(async file=>{
    const p = join(source, file)
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
  opts.replace = opts.replace || {}
  const oldname = opts.replace.find, newname = opts.replace.replaceWith
  return new Promise( (resolve, reject)=>{
    const ws = fs.createWriteStream(destname)
    let rs
    if (oldname && newname) {
      rs = fs.createReadStream(p).pipe(loner(opts.oldname))
        .on('data', data=>{
          if (data == opts.oldname) data = opts.newname
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
