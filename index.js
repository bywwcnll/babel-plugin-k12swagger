const fs = require('fs')
const path = require('path')
const uniq = require('lodash.uniq')

const tmpDepsFileAbsPath = path.resolve('node_modules/.swaggerTmp/__tmpSwaggerDeps.json')
let usedModulesData = {}
let MIN_VUEX = null
if (fs.existsSync(tmpDepsFileAbsPath)) {
  let fileContents = fs.readFileSync(tmpDepsFileAbsPath, { encoding: 'utf8' })
  let fileContentsData = JSON.parse(fileContents || '{"result": {}}')
  usedModulesData = fileContentsData.result
  MIN_VUEX = fileContentsData.MIN_VUEX
}

/* 搜索并保存已使用的swagger模块 */
const getSearchVisitor = ( { types: t } ) => {
  let result = null
  const getActionObject = (el) => {
    if (t.isStringLiteral(el[0])) {
      let actionArray = []
      if (t.isArrayExpression(el[1])) {
        el[1].elements.forEach(i => {
          if (t.isStringLiteral(i)) {
            actionArray.push(i.value)
          }
        })
      }
      if (t.isObjectExpression(el[1])) {
        el[1].properties.forEach(i => {
          if (t.isObjectProperty(i) && t.isStringLiteral(i.value)) {
            actionArray.push(i.value.value)
          }
        })
      }
      return {
        key: [el[0].value],
        value: actionArray
      }
    }
    return null
  }
  const ObjectPropertyVisitor = {
    ObjectProperty({node}) {
      if (
        !t.isIdentifier(node.key, {name: 'methods'})
        || !t.isObjectExpression(node.value)
        || node.value.properties.length < 1
      ) return
    
      let mapActionsList = node.value.properties
        .filter(el => /^(SpreadElement|SpreadProperty)$/.test(el.type))
        .filter(el => t.isCallExpression(el.argument))
        .map(el => el.argument)
        .filter(el => t.isIdentifier(el.callee, {name: 'mapActions'}) && el.arguments.length === 2)
        .map(el => el.arguments)
    
      let loadedModules = {}
      mapActionsList
        .map(el => getActionObject(el))
        .filter(el => el)
        .forEach(({key, value}) => {
          if (!loadedModules.hasOwnProperty(key)) {
            loadedModules[key] = value
          } else {
            loadedModules[key] = uniq([...loadedModules[key], ...value])
          }
        })
    
      Object.keys(loadedModules).forEach(key => {
        value = loadedModules[key]
        if (!result.hasOwnProperty(key)) {
          result[key] = value
        } else {
          result[key] = uniq([...result[key], ...value])
        }
      })
    }
  }
  
  return {
    pre(state) {
      result = {}
    },
    visitor: {
      Program (path) {
        let filename = this.file.opts.filename
        if (/(\.vue|mixins\/\w+\.js)$/.test(filename)) {
          path.traverse(ObjectPropertyVisitor)
        }
      },
    },
    post(state) {
      const keys = Object.keys(result)
      if (keys.length > 0) {
        const fileContents = fs.readFileSync(tmpDepsFileAbsPath, { encoding: 'utf8' })
        const oldData = JSON.parse(fileContents || '{"result": {}}')
        const oldDataKeys = Object.keys(oldData.result)
        let willSavedResult = {}
        uniq([...oldDataKeys, ...keys]).forEach(k => {
          const r1 = oldData.result.hasOwnProperty(k) ? oldData.result[k] : []
          const r2 = result.hasOwnProperty(k) ? result[k] : []
          willSavedResult[k] = uniq([ ...r1, ...r2 ])
        })
        const saveData = {
          ...oldData,
          result: willSavedResult
        }
        console.log(`已使用的模块: ${Object.keys(saveData.result)}`)
        fs.writeFileSync(tmpDepsFileAbsPath, JSON.stringify(saveData))
      }
    }
  }
}

/* 过滤有效swagger模块 */
const getFilterVisitor = ( { types: t } ) => {
  let usedModules = Object.keys(usedModulesData)
  const removeModuleVisitor1 = {
    ObjectProperty (path) {
      let { node, parent, parentPath } = path
      if (
        !t.isObjectExpression(parent)
        || !t.isObjectProperty(parentPath.parent)
        || !t.isIdentifier(parentPath.parent.key, { name: 'modules' })
      ) return
      let moduleName = node.key ? node.key.name : ''
      if (usedModules.indexOf(moduleName) === -1 && moduleName !== 'common') {
        // console.log(`移除Store: ${moduleName}模块\r`)
        path.remove()
      }
    }
  }
  const unusedModulesVisitor = {
    ImportDefaultSpecifier ({node, parent, parentPath}) {
      if (
        !t.isImportDeclaration(parent)
        || !(parent.source.type === 'StringLiteral' && /^.\/modules\/swagger\//.test(parent.source.value))
        || !(node.local.type === 'Identifier' && usedModules.indexOf(node.local.name) === -1)
      ) return
      console.log(`移除swagger引用: ${node.local.name}模块\r`)
      parentPath.remove()
    },
    MemberExpression ({node, parentPath}) {
      if (
        !t.isIdentifier(node.object, { name: 'Vuex' })
        || !t.isIdentifier(node.property, { name: 'Store' })
        || !t.isNewExpression(parentPath.node)
      ) return
      parentPath.traverse(removeModuleVisitor1)
    }
  }
  const ObjectMethodVisitor = {
    ObjectMethod (path) {
      let {node, parent, parentPath} = path
      if (
        !t.isObjectExpression(parent)
        || !t.isIdentifier(parentPath.parent.id, { name: 'actions' })
        || this.usedActions.indexOf(node.key.name) > -1
      ) return
      console.log(`移除${this.moduleName}模块中的${node.key.name}方法\r`)
      path.remove()
    }
  }
  return {
    visitor: {
      Program (path) {
        let filename = this.file.opts.filename
        if (/store.js$/.test(filename)) {
          path.traverse(unusedModulesVisitor)
        }
        let reg = new RegExp(`(${usedModules.filter(k => k !== 'common').map(k => k + '.js').join('|')})$`)
        let matches = filename.match(reg) || []
        if (matches[0]) {
          const moduleName = matches[0].slice(0, -3)
          path.traverse(ObjectMethodVisitor, {
            moduleName,
            usedActions: usedModulesData[moduleName]
          })
        }
      }
    }
  }
}

const getVisitor = ( babelHelper ) => {
  if (MIN_VUEX === 'search') {
    return getSearchVisitor(babelHelper)
  } else if (MIN_VUEX === 'filter') {
    return getFilterVisitor(babelHelper)
  } else {
    return { visitor: {} }
  }
}

module.exports = getVisitor
