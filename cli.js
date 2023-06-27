const conf = require('rc')('tinit')
const fs = require('fs')
const {readdir, stat} = require('fs/promises')
const {join, parse} = require('path')
const {mkdirp} = require('mkdirp')
const loner = require('loner')

async function main() {
  if (!process.env.TISL_SDK) bail(new Error('Please use "source <(tisl env SDK_VERSION) to select an SDK'))

  if (conf._.length !== 2) {
    usage()
    bail(new Error('Not enough arguments'))
  }

  const [src, newname] = conf._
  const {base, dir} = parse(src)
  const source = `${process.env.TISL_SDK}/examples/rtos/${process.env.BOARDNAME}/${dir}/${base}`
  const dest = newname

  console.log(`Copying ${source} to ${dest}`)

  await copyFiles(join(process.env.TISL_SDK, 'kernel'), join(dest, 'kernel'))
  await copyFiles(source, join(dest, 'app'), {oldname: base, newname})
  await copyFile(join(process.env.TISL_SDK, 'imports.mak'), join(dest, 'imports.mak'))
  await copyFile(join(__dirname, 'make.sh'), join(dest, 'make.sh'))
}

main()

// -- util

async function copyFiles(source, dest, opts) {
  opts = opts || {}
  await mkdirp(dest)
  const files = await readdir(source)
  return Promise.all(files.map(async file=>{
    const p = join(source, file)
    const s = await stat(p)
    const destname = join(dest, processName(file, opts))
    console.log(destname)
    if (s.isDirectory()) return copyFiles(p, destname,  opts)
    return copyFile(p, destname, opts)
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
        resolve()
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
}

function bail(err) {
  if (!err) return
  console.error(err.message)
  process.exit(1)
}
