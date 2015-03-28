
var CHILD_ROUTE_SUFFIX = '/*childRoute';

/*
 * only one of these
 */
class Grammar {
  rules: { [name: string]: CanonicalRecognizer };
  constructor() {
    this.rules = {};
  }

  config(name: string, config: Mapping) {
    if (name === 'app') {
      name = '/';
    }
    if (!this.rules[name]) {
      this.rules[name] = new CanonicalRecognizer(name);
    }
    this.rules[name].config(config);
  }

  recognize(url: string, componentName = '/') {

    var componentRecognizer = this.rules[componentName];
    if (!componentRecognizer) {
      return;
    }

    var context: recognizer.Result = componentRecognizer.recognize(url);
    if (!context) {
      return;
    }

    var lastContextChunk = context[context.length - 1];
    var lastHandler = lastContextChunk.handler;
    var lastParams = lastContextChunk.params;

    var instruction: Instruction = {
      viewports: {},
      params: lastParams
    };

    if (lastParams && lastParams.childRoute) {
      var childUrl = '/' + lastParams.childRoute;
      // TODO: handle multiple children
      instruction.canonicalUrl = lastHandler.rewroteUrl.substr(0, lastHandler.rewroteUrl.length - (lastParams.childRoute.length + 1));

      forEach(lastHandler.components,(componentName: string, viewportName: string) => {
        instruction.viewports[viewportName] = this.recognize(childUrl, componentName);
      });

      instruction.canonicalUrl += instruction.viewports[Object.keys(instruction.viewports)[0]].canonicalUrl;
    } else {
      instruction.canonicalUrl = lastHandler.rewroteUrl;
      forEach(lastHandler.components,(componentName: string, viewportName: string) => {
        instruction.viewports[viewportName] = {
          viewports: {}
        };
      });
    }

    forEach(instruction.viewports,(instruction: Instruction, componentName: string) => {
      instruction.component = lastHandler.components[componentName];
      instruction.params = lastParams;
    });

    return instruction;
  }

  generate(name: string, params: recognizer.Params) {
    var path = '';
    var solution: RouteRecognizer;
    do {
      solution = null;
      forEach(this.rules,(recognizer: RouteRecognizer) => {
        if (recognizer.hasRoute(name)) {
          path = recognizer.generate(name, params) + path;
          solution = recognizer;
        }
      });
      if (!solution) {
        return '';
      }
      name = solution.name;
    } while (solution.name !== '/');

    return path;
  }
}

/*
 * includes redirect rules
 */
class CanonicalRecognizer {
  name: string;
  recognizer: RouteRecognizer;
  rewrites: { [name: string]: RewriteFunction };
  constructor(name: string) {
    this.name = name;
    this.rewrites = {};
    this.recognizer = new RouteRecognizer();
  }

  config(mapping: Mapping|Mapping[]) {
    if (mapping instanceof Array) {
      (<Mapping[]>mapping).forEach(nav => this.configOne(nav));
    } else {
      this.configOne(<Mapping>mapping);
    }
  }

  getCanonicalUrl(url: string) {
    if (url[0] === '.') {
      url = url.substr(1);
    }

    if (url === '' || url[0] !== '/') {
      url = '/' + url;
    }

    // TODO: normalize this
    forEach(this.rewrites, function(toUrl: string, fromUrl: string) {
      if (fromUrl === '/') {
        if (url === '/') {
          url = toUrl;
        }
      } else if (url.indexOf(fromUrl) === 0) {
        url = url.replace(fromUrl, toUrl);
      }
    });

    return url;
  }

  configOne(mapping: Mapping) {
    if (mapping.redirectTo) {
      if (this.rewrites[mapping.path]) {
        throw new Error('"' + mapping.path + '" already maps to "' + this.rewrites[mapping.path] + '"');
      }
      this.rewrites[mapping.path] = mapping.redirectTo;
      return;
    }

    // normalize "component" and "components" in config
    if (mapping.component) {
      if (mapping.components) {
        throw new Error('A route config should have either a "component" or "components" property, but not both.');
      }
      mapping.components = mapping.component;
      delete mapping.component;
    }
    if (typeof mapping.components === 'string') {
      mapping.components = { default: mapping.components };
    }
    var aliases: string[];
    if (mapping.as) {
      aliases = [mapping.as];
    } else {
      aliases = mapObj(mapping.components,
        (componentName: string, viewportName: string) => viewportName + ':' + componentName);

      if (mapping.components.default) {
        aliases.push(mapping.components.default);
      }
    }
    aliases.forEach(alias => this.recognizer.add([{ path: mapping.path, handler: mapping }], { as: alias }));

    var withChild = copy(mapping);
    withChild.path += CHILD_ROUTE_SUFFIX;
    this.recognizer.add([{
      path: withChild.path,
      handler: withChild
    }]);
  }

  recognize(url: string): recognizer.Result {
    var canonicalUrl = this.getCanonicalUrl(url);
    var context = this.recognizer.recognize(canonicalUrl);
    if (context) {
      context[0].handler.rewroteUrl = canonicalUrl;
    }
    return context;
  }

  generate(name: string, params: recognizer.Params) {
    return this.recognizer.generate(name, params);
  }

  hasRoute(name: string) {
    return this.recognizer.hasRoute(name);
  }
}
