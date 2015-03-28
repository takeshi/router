///  <reference path="../typings/angularjs/angular.d.ts" />
///  <reference path="../typings/angularjs/angular-animate.d.ts" />



'use strict';

/*
 * A module for adding new a routing system Angular 1.
 */
angular.module('ngNewRouter', [])
  .factory('$router', routerFactory)
  .value('$routeParams', {})
  .provider('$componentLoader', $componentLoaderProvider)
  .provider('$pipeline', pipelineProvider)
  .factory('$$pipeline', privatePipelineFactory)
  .factory('$setupRoutersStep', setupRoutersStepFactory)
  .factory('$initLocalsStep', initLocalsStepFactory)
  .factory('$initControllersStep', initControllersStepFactory)
  .factory('$runCanDeactivateHookStep', runCanDeactivateHookStepFactory)
  .factory('$runCanActivateHookStep', runCanActivateHookStepFactory)
  .factory('$loadTemplatesStep', loadTemplatesStepFactory)
  .value('$activateStep', activateStepValue)
  .directive('ngViewport', ngViewportDirective)
  .directive('ngViewport', ngViewportFillContentDirective)
  .directive('ngLink', ngLinkDirective)
  .directive('a', anchorLinkDirective)

/*
 * A module for inspecting controller constructors
 */
angular.module('ng')
  .provider('$controllerIntrospector', $controllerIntrospectorProvider)
  .config(controllerProviderDecorator);

/*
 * decorates with routing info
 */
function controllerProviderDecorator(
  $controllerProvider: angular.IControllerProvider,
  $controllerIntrospectorProvider: ControllerIntrospectorProvider) {
  var register = $controllerProvider.register;
  $controllerProvider.register = function(name: string, ctrl: any) {
    $controllerIntrospectorProvider.register(name, ctrl);
    return register.apply(this, arguments);
  };
}

/*
 * private service that holds route mappings for each controller
 */
function $controllerIntrospectorProvider() {
  var controllers: any[] = [];
  var onControllerRegistered: ControllerRegister = null;
  return {
    register: function(name: string, constructor: any) {
      if (angular.isArray(constructor)) {
        constructor = constructor[constructor.length - 1];
      }
      if (constructor.$routeConfig) {
        if (onControllerRegistered) {
          onControllerRegistered(name, constructor.$routeConfig);
        } else {
          controllers.push({ name: name, config: constructor.$routeConfig });
        }
      }
    },
    $get: ['$componentLoader', function($componentLoader: ComponentLoader) {
      return function(newOnControllerRegistered: ControllerRegister) {
        onControllerRegistered = function(name, constructor) {
          name = $componentLoader.component(name);
          return newOnControllerRegistered(name, constructor);
        };
        while (controllers.length > 0) {
          var rule = controllers.pop();
          onControllerRegistered(rule.name, rule.config);
        }
      }
    }]
  }
}

function routerFactory($$rootRouter: RootRouter, $rootScope: angular.IRootScopeService, $location: angular.ILocationService, $$grammar: Grammar, $controllerIntrospector: ControllerIntrospector) {

  $controllerIntrospector(function(name, config) {
    $$grammar.config(name, config);
  });

  $rootScope.$watch(function() {
    return $location.path();
  }, function(newUrl) {
      $$rootRouter.navigate(newUrl);
    });

  var nav = $$rootRouter.navigate;
  $$rootRouter.navigate = function(url) {
    return nav.call(this, url).then(function(newUrl: string) {
      if (newUrl) {
        $location.path(newUrl);
      }
    });
  }

  return $$rootRouter;
}

/**
 * @name ngViewport
 *
 * @description
 * An ngViewport is where resolved content goes.
 *
 * ## Use
 *
 * ```html
 * <div router-viewport="name"></div>
 * ```
 *
 * The value for the `ngViewport` attribute is optional.
 */
function ngViewportDirective($animate: angular.animate.IAnimateService, $injector: angular.auto.IInjectorService, $q: angular.IQService, $router: Router) {
  var rootRouter = $router;

  return {
    restrict: 'AE',
    transclude: 'element',
    terminal: true,
    priority: 400,
    require: ['?^^ngViewport', 'ngViewport'],
    link: viewportLink,
    controller: function() { },
    controllerAs: '$$ngViewport'
  };

  function invoke(method: Function, context: recognizer.Result, instruction: Instruction) {
    return $injector.invoke(method, context, instruction.locals);
  }

  function viewportLink(scope: angular.IScope, $element: JQuery, attrs: angular.IAttributes, ctrls: any, $transclude: angular.ITranscludeFunction) {
    var viewportName = attrs['ngViewport'] || 'default',
      parentCtrl = ctrls[0],
      myCtrl = ctrls[1],
      router = (parentCtrl && parentCtrl.$$router) || rootRouter;

    var currentScope: angular.IScope,
      newScope: angular.IScope,
      currentController: any,
      currentElement: JQuery,
      previousLeaveAnimation: ng.IPromise<any>,
      previousInstruction: string;

    function cleanupLastView() {
      if (previousLeaveAnimation) {
        $animate.cancel(previousLeaveAnimation);
        previousLeaveAnimation = null;
      }

      if (currentScope) {
        currentScope.$destroy();
        currentScope = null;
      }
      if (currentElement) {
        previousLeaveAnimation = $animate.leave(currentElement);
        previousLeaveAnimation.then(function() {
          previousLeaveAnimation = null;
        });
        currentElement = null;
      }
    }

    router.registerViewport({
      canDeactivate: function(instruction: Instruction) {
        if (currentController && currentController.canDeactivate) {
          return invoke(currentController.canDeactivate, currentController, instruction);
        }
        return true;
      },
      activate: function(instruction: Instruction) {
        var nextInstruction = serializeInstruction(instruction);
        if (nextInstruction === previousInstruction) {
          return;
        }

        instruction.locals.$scope = newScope = scope.$new();
        myCtrl.$$router = instruction.router;
        myCtrl.$$template = instruction.template;
        var componentName = instruction.component;
        var clone = $transclude(newScope, function(clone: JQuery) {
          $animate.enter(clone, null, currentElement || $element);
          cleanupLastView();
        });

        var newController = instruction.controller;
        newScope[componentName] = newController;

        var result: any;
        if (currentController && currentController.deactivate) {
          result = $q.when(invoke(currentController.deactivate, currentController, instruction));
        }

        currentController = newController;

        currentElement = clone;
        currentScope = newScope;

        previousInstruction = nextInstruction;

        // finally, run the hook
        if (newController.activate) {
          var activationResult = $q.when(invoke(newController.activate, newController, instruction));
          if (result) {
            return result.then(activationResult);
          } else {
            return activationResult;
          }
        }
        return result;
      }
    }, viewportName);
  }

  // TODO: how best to serialize?
  function serializeInstruction(instruction: Instruction): string {
    return JSON.stringify({
      path: instruction.path,
      component: instruction.component,
      params: Object.keys(instruction.params).reduce(function(acc: any, key: string) {
        return (key !== 'childRoute' && (acc[key] = instruction.params[key])), acc;
      }, {})
    });
  }
}

function ngViewportFillContentDirective($compile: angular.ICompileService) {
  return {
    restrict: 'EA',
    priority: -400,
    require: 'ngViewport',
    link: function(scope: angular.IScope, $element: JQuery, attrs: angular.IAttributes, ctrl: any) {
      var template = ctrl.$$template;
      $element.html(template);
      var link = $compile($element.contents());
      link(scope);
    }
  };
}

function makeComponentString(name: string): string {
  return [
    '<router-component component-name="', name, '">',
    '</router-component>'
  ].join('');
}


var LINK_MICROSYNTAX_RE = /^(.+?)(?:\((.*)\))?$/;
/**
 * @name ngLink
 * @description
 * Lets you link to different parts of the app, and automatically generates hrefs.
 *
 * ## Use
 * The directive uses a simple syntax: `router-link="componentName({ param: paramValue })"`
 *
 * ## Example
 *
 * ```js
 * angular.module('myApp', ['ngFuturisticRouter'])
 *   .controller('AppController', ['$router', function($router) {
 *     $router.config({ path: '/user/:id' component: 'user' });
 *     this.user = { name: 'Brian', id: 123 };
 *   });
 * ```
 *
 * ```html
 * <div ng-controller="AppController as app">
 *   <a router-link="user({id: app.user.id})">{{app.user.name}}</a>
 * </div>
 * ```
 */
function ngLinkDirective($router: Router, $location: angular.ILocaleService, $parse: angular.IModelParser) {
  var rootRouter = $router;

  return {
    require: '?^^ngViewport',
    restrict: 'A',
    link: ngLinkDirectiveLinkFn
  };

  function ngLinkDirectiveLinkFn(scope: angular.IScope, elt: JQuery, attrs: angular.IAttributes, ctrl: any) {
    var router = (ctrl && ctrl.$$router) || rootRouter;
    if (!router) {
      return;
    }

    var link = attrs['ngLink'] || '';
    var parts = link.match(LINK_MICROSYNTAX_RE);
    var routeName = parts[1];
    var routeParams = parts[2];
    var url: string;

    if (routeParams) {
      var routeParamsGetter = $parse(routeParams);
      // we can avoid adding a watcher if it's a literal
      if (routeParamsGetter.constant) {
        var params = routeParamsGetter();
        url = '.' + router.generate(routeName, params);
        elt.attr('href', url);
      } else {
        scope.$watch(function() {
          return routeParamsGetter(scope);
        }, function(params) {
            url = '.' + router.generate(routeName, params);
            elt.attr('href', url);
          }, true);
      }
    } else {
      url = '.' + router.generate(routeName);
      elt.attr('href', url);
    }
  }
}


function anchorLinkDirective($router: Router) {
  return {
    restrict: 'E',
    link: function(scope: angular.IScope, element: JQuery) {
      // If the linked element is not an anchor tag anymore, do nothing
      if (element[0].nodeName.toLowerCase() !== 'a') return;

      // SVGAElement does not use the href attribute, but rather the 'xlinkHref' attribute.
      var hrefAttrName = Object.prototype.toString.call(element.prop('href')) === '[object SVGAnimatedString]' ?
        'xlink:href' : 'href';

      element.on('click', function(event) {
        var href = element.attr(hrefAttrName);
        if (!href) {
          event.preventDefault();
        }
        if ($router.recognize(href)) {
          $router.navigate(href);
          event.preventDefault();
        }
      });
    }
  }
}

function setupRoutersStepFactory() {
  return function(instruction: Instruction) {
    return instruction.router.makeDescendantRouters(instruction);
  }
}

/*
 * $initLocalsStep
 */
function initLocalsStepFactory() {
  return function initLocals(instruction: Instruction) {
    return instruction.router.traverseInstruction(instruction, function(instruction: Instruction) {
      instruction.locals = {
        $router: instruction.router,
        $routeParams: (instruction.params || <recognizer.Params>{})
      };
      return
    });
  }
}

/*
 * $initControllersStep
 */
function initControllersStepFactory($controller: Function, $componentLoader: ComponentLoader) {
  return function initControllers(instruction: Instruction) {
    return instruction.router.traverseInstruction(instruction, function(instruction: Instruction) {
      var controllerName = $componentLoader.controllerName(instruction.component);
      var locals = instruction.locals;
      var ctrl: any;
      try {
        ctrl = $controller(controllerName, locals);
      } catch (e) {
        console.warn && console.warn('Could not instantiate controller', controllerName);
        ctrl = $controller(angular.noop, locals);
      }
      return instruction.controller = ctrl;
    });
  }
}

function runCanDeactivateHookStepFactory() {
  return function runCanDeactivateHook(instruction: Instruction) {
    return instruction.router.canDeactivatePorts(instruction);
  };
}

function runCanActivateHookStepFactory($injector: angular.auto.IInjectorService) {

  function invoke(method: Function, context: recognizer.Result, instruction: Instruction) {
    return $injector.invoke(method, context, {
      $routeParams: instruction.params
    });
  }

  return function runCanActivateHook(instruction: Instruction) {
    return instruction.router.traverseInstruction(instruction, function(instruction: Instruction) {
      var controller = instruction.controller;
      return !controller.canActivate || invoke(controller.canActivate, controller, instruction);
    });
  }
}

function loadTemplatesStepFactory($componentLoader: ComponentLoader, $templateRequest: angular.ITemplateRequestService) {
  return function loadTemplates(instruction: Instruction) {
    return instruction.router.traverseInstruction(instruction, function(instruction: Instruction) {
      var componentTemplateUrl = $componentLoader.template(instruction.component);
      return $templateRequest(componentTemplateUrl).then(function(templateHtml) {
        return instruction.template = templateHtml;
      });
    });
  };
}


function activateStepValue(instruction: Instruction) {
  return instruction.router.activatePorts(instruction);
}


function pipelineProvider() {
  var stepConfiguration: any[];

  var protoStepConfiguration = [
    '$setupRoutersStep',
    '$initLocalsStep',
    '$initControllersStep',
    '$runCanDeactivateHookStep',
    '$runCanActivateHookStep',
    '$loadTemplatesStep',
    '$activateStep'
  ];

  return {
    steps: protoStepConfiguration.slice(0),
    config: function(newConfig: string[]) {
      protoStepConfiguration = newConfig;
    },
    $get: function($injector: angular.auto.IInjectorService, $q: angular.IQService) {
      stepConfiguration = protoStepConfiguration.map(function(step) {
        return $injector.get(step);
      });
      return {
        process: function(instruction: Instruction): any {
          // make a copy
          var steps = stepConfiguration.slice(0);

          function processOne(result: recognizer.Result): any {
            if (steps.length === 0) {
              return result;
            }
            var step = steps.shift();
            return $q.when(step(instruction)).then(processOne);
          }

          return processOne(null);
        }
      }
    }
  };
}


/**
 * @name $componentLoaderProvider
 * @description
 *
 * This lets you configure conventions for what controllers are named and where to load templates from.
 *
 * The default behavior is to dasherize and serve from `./components`. A component called `myWidget`
 * uses a controller named `MyWidgetController` and a template loaded from `./components/my-widget/my-widget.html`.
 *
 * A component is:
 * - a controller
 * - a template
 * - an optional router
 *
 * This service makes it easy to group all of them into a single concept.
 */
function $componentLoaderProvider() {

  var DEFAULT_SUFFIX = 'Controller';

  var componentToCtrl = function componentToCtrlDefault(name: string) {
    return name[0].toUpperCase() + name.substr(1) + DEFAULT_SUFFIX;
  };

  var componentToTemplate = function componentToTemplateDefault(name: string) {
    var dashName = dashCase(name);
    return './components/' + dashName + '/' + dashName + '.html';
  };

  var ctrlToComponent = function ctrlToComponentDefault(name: string) {
    return name[0].toLowerCase() + name.substr(1, name.length - DEFAULT_SUFFIX.length - 1);
  };

  return {
    $get: function(): ComponentLoader {
      return {
        controllerName: componentToCtrl,
        template: componentToTemplate,
        component: ctrlToComponent
      };
    },

    /**
     * @name $componentLoaderProvider#setCtrlNameMapping
     * @description takes a function for mapping component names to component controller names
     */
    setCtrlNameMapping: function(newFn: NameExchanger) {
      componentToCtrl = newFn;
      return this;
    },

    /**
     * @name $componentLoaderProvider#setCtrlNameMapping
     * @description takes a function for mapping component controller names to component names
     */
    setComponentFromCtrlMapping: function(newFn: NameExchanger) {
      ctrlToComponent = newFn;
      return this;
    },

    /**
     * @name $componentLoaderProvider#setTemplateMapping
     * @description takes a function for mapping component names to component template URLs
     */
    setTemplateMapping: function(newFn: NameExchanger) {
      componentToTemplate = newFn;
      return this;
    }
  };
}

// this is a hack as a result of the build system used to transpile
function privatePipelineFactory($pipeline: Pipeline) {
  return $pipeline;
}


function dashCase(str: string) {
  return str.replace(/([A-Z])/g, function($1) {
    return '-' + $1.toLowerCase();
  });
}
