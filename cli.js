#!/usr/bin/env node
const conf = require('rc')('tinit')
const fs = require('fs')
const {readdir, stat} = require('fs/promises')
const {join, parse, relative} = require('path')
const {mkdirp} = require('mkdirp')
const loner = require('loner')

async function main() {
  if (!process.env.TISL_SDK) bail(new Error('Please use "source <(tisl env SDK_VERSION) to select an SDK'))

  if (conf._[0] == 'ls') {
    return listExamples()
  }

  if (conf._.length !== 2) {
    usage()
    bail(new Error('Not enough arguments'))
  }

  const [src, newname] = conf._
  const {base, dir} = parse(src)
  const source = `${process.env.TISL_SDK}/examples/rtos/${process.env.BOARDNAME}/${dir}/${base}`
  const dest = newname

  console.log(`Copying ${source} to ${dest}`)

  await findFiles(join(process.env.TISL_SDK, 'kernel'), {action: copyFilesTo(join(dest, 'kernel'))})
  await findFiles(source, {oldname: base, newname, action: copyFilesTo(join(dest, 'app'))})
  await copyFile(join(process.env.TISL_SDK, 'imports.mak'), join(dest, 'imports.mak'))
  await copyFile(join(__dirname, 'make.sh'), join(dest, 'make.sh'))
}

main()

// -- util

async function listExamples() {
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
    const collections = 'boardname rtos compiler'.split(' ')
    for(const c of collections) {
      a[c] = a[c] || []
      if (!a[c].includes(ex[c])) a[c].push(ex[c])
    }
    return acc
  }, {})
  for (const name of Object.keys(examples).sort()) {
    const {boardname, rtos, compiler} = examples[name]
    console.log(`${name} [${boardname.join(' ')}] (${rtos.join(' ')}) {${compiler.join(' ')}}`)
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
  const {oldname, newname} = opts
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
