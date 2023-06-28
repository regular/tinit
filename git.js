const {spawn} = require('child_process')
const pull = require('pull-stream')
const toPull = require('stream-to-pull-stream')
const split = require('pull-split')
const utf8 = require('pull-utf8-decoder')

module.exports = function(repo) {

  return {
    init,
    add,
    commit
  }

  function init() {
    return cmd('init')
  }

  function add(files) {
    return cmd('add', files)
  }
  function commit(message) {
    return cmd('commit', ['-am', message])
  }

  function cmd(command, args) {
    args = args || []
    if (!Array.isArray(args)) args = [args]
    let _lines = []
    return new Promise( (resolve, reject)=>{
      console.error('git', command, args.join(' '))
      const git = spawn('git',
        [command].concat(args)
      , {
        cwd: repo
      }).on('exit', code=>{
        if (code) return reject(new Error(`git exit code: ${code}`))
        console.error(_lines)
        resolve(_lines)
      })
      pull(lines(git.stderr), pull.drain(x=>process.stderr.write(x), err=>{
        if (err) console.error(err.message)
      }))
      pull(lines(git.stdout), pull.collect( (err, lines)=>{
        if (err) {
          console.error(lines)
          reject(err)
        }
        // give a chance to reject due to exit code
        _lines = lines
      }))
    })
  }

}

// -- utils

function linesPromis(stream) {
  return new Promise( (resolve, reject)=>{
    pull(
      lines(stream),
      pull.through(console.log),
      pull.collect( (err, result)=>{
        if (err) return reject(err)
        resolve(result)
      })
    )
  })
}

function lines(stream) {
  return pull(
    toPull.source(stream),
    utf8(),
    split()
  )
}

