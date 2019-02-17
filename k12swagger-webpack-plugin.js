const fs = require('fs')
const path = require('path')

const tmpDirPath = path.resolve('node_modules/.swaggerTmp')
const tmpDepsFilePath = path.resolve(tmpDirPath, '__tmpSwaggerDeps.json')
const run = () => {
  if (!fs.existsSync(tmpDirPath)) fs.mkdirSync(tmpDirPath)
  if (process.env.MIN_VUEX === 'search') {
    if (fs.existsSync(tmpDepsFilePath)) fs.unlinkSync(tmpDepsFilePath)
    fs.writeFileSync(tmpDepsFilePath, JSON.stringify({
      result: {},
      date: new Date(),
      MIN_VUEX: process.env.MIN_VUEX
    }))
  } else if (process.env.MIN_VUEX === 'filter' && fs.existsSync(tmpDepsFilePath)) {
    let fileContents = fs.readFileSync(tmpDepsFilePath, { encoding: 'utf8' })
    let fileContentsData = JSON.parse(fileContents || '{"result": {}}')
    fs.writeFileSync(tmpDepsFilePath, JSON.stringify({
      ...fileContentsData,
      MIN_VUEX: process.env.MIN_VUEX
    }))
  } else {
    fs.writeFileSync(tmpDepsFilePath, JSON.stringify({
      result: {},
      date: new Date()
    }))
  }
}
module.exports = class K12swaggerWebpackPlugin {
  apply (compiler) {
    if (compiler.hooks && compiler.hooks.entryOption) {
      compiler.hooks.entryOption.tap('k12swagger-webpack-plugin', run)
    } else {
      compiler.plugin('entry-option', run)
    }
  }
}
