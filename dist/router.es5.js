angular.module('ngNewRouter')
.factory('$$rootRouter', ['$$grammar','$$pipeline','$q',
  function ($$grammar, $$pipeline,$q) {
    if(!window.$q){
      window.$q = $q;
    }
    return new RootRouter($$grammar,$$pipeline);
  }]
);

angular.module('ngNewRouter')
.factory('$$grammar',['$q',function($q){
    if(!window.$q){
      window.$q = $q;
    }
    return new Grammar();
  }]
);

var CHILD_ROUTE_SUFFIX = '/*childRoute';
/*
 * only one of these
 */
var Grammar = (function () {
    function Grammar() {
        this.rules = {};
    }
    Grammar.prototype.config = function (name, config) {
        if (name === 'app') {
            name = '/';
        }
        if (!this.rules[name]) {
            this.rules[name] = new CanonicalRecognizer(name);
        }
        this.rules[name].config(config);
    };
    Grammar.prototype.recognize = function (url, componentName) {
        var _this = this;
        if (componentName === void 0) { componentName = '/'; }
        var componentRecognizer = this.rules[componentName];
        if (!componentRecognizer) {
            return;
        }
        var context = componentRecognizer.recognize(url);
        if (!context) {
            return;
        }
        var lastContextChunk = context[context.length - 1];
        var lastHandler = lastContextChunk.handler;
        var lastParams = lastContextChunk.params;
        var instruction = {
            viewports: {},
            params: lastParams
        };
        if (lastParams && lastParams.childRoute) {
            var childUrl = '/' + lastParams.childRoute;
            // TODO: handle multiple children
            instruction.canonicalUrl = lastHandler.rewroteUrl.substr(0, lastHandler.rewroteUrl.length - (lastParams.childRoute.length + 1));
            forEach(lastHandler.components, function (componentName, viewportName) {
                instruction.viewports[viewportName] = _this.recognize(childUrl, componentName);
            });
            instruction.canonicalUrl += instruction.viewports[Object.keys(instruction.viewports)[0]].canonicalUrl;
        }
        else {
            instruction.canonicalUrl = lastHandler.rewroteUrl;
            forEach(lastHandler.components, function (componentName, viewportName) {
                instruction.viewports[viewportName] = {
                    viewports: {}
                };
            });
        }
        forEach(instruction.viewports, function (instruction, componentName) {
            instruction.component = lastHandler.components[componentName];
            instruction.params = lastParams;
        });
        return instruction;
    };
    Grammar.prototype.generate = function (name, params) {
        var path = '';
        var solution;
        do {
            solution = null;
            forEach(this.rules, function (recognizer) {
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
    };
    return Grammar;
})();
/*
 * includes redirect rules
 */
var CanonicalRecognizer = (function () {
    function CanonicalRecognizer(name) {
        this.name = name;
        this.rewrites = {};
        this.recognizer = new RouteRecognizer();
    }
    CanonicalRecognizer.prototype.config = function (mapping) {
        var _this = this;
        if (mapping instanceof Array) {
            mapping.forEach(function (nav) { return _this.configOne(nav); });
        }
        else {
            this.configOne(mapping);
        }
    };
    CanonicalRecognizer.prototype.getCanonicalUrl = function (url) {
        if (url[0] === '.') {
            url = url.substr(1);
        }
        if (url === '' || url[0] !== '/') {
            url = '/' + url;
        }
        // TODO: normalize this
        forEach(this.rewrites, function (toUrl, fromUrl) {
            if (fromUrl === '/') {
                if (url === '/') {
                    url = toUrl;
                }
            }
            else if (url.indexOf(fromUrl) === 0) {
                url = url.replace(fromUrl, toUrl);
            }
        });
        return url;
    };
    CanonicalRecognizer.prototype.configOne = function (mapping) {
        var _this = this;
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
        var aliases;
        if (mapping.as) {
            aliases = [mapping.as];
        }
        else {
            aliases = mapObj(mapping.components, function (componentName, viewportName) { return viewportName + ':' + componentName; });
            if (mapping.components.default) {
                aliases.push(mapping.components.default);
            }
        }
        aliases.forEach(function (alias) { return _this.recognizer.add([{ path: mapping.path, handler: mapping }], { as: alias }); });
        var withChild = copy(mapping);
        withChild.path += CHILD_ROUTE_SUFFIX;
        this.recognizer.add([{
            path: withChild.path,
            handler: withChild
        }]);
    };
    CanonicalRecognizer.prototype.recognize = function (url) {
        var canonicalUrl = this.getCanonicalUrl(url);
        var context = this.recognizer.recognize(canonicalUrl);
        if (context) {
            context[0].handler.rewroteUrl = canonicalUrl;
        }
        return context;
    };
    CanonicalRecognizer.prototype.generate = function (name, params) {
        return this.recognizer.generate(name, params);
    };
    CanonicalRecognizer.prototype.hasRoute = function (name) {
        return this.recognizer.hasRoute(name);
    };
    return CanonicalRecognizer;
})();

/// <reference path="../typings/es6-promise/es6-promise.d.ts" />
///  <reference path="../typings/angularjs/angular.d.ts" />

var Pipeline = (function () {
    function Pipeline() {
        this.steps = [
            function (instruction) { return instruction.router.makeDescendantRouters(instruction); },
            function (instruction) { return instruction.router.canDeactivatePorts(instruction); },
            function (instruction) { return instruction.router.traversePorts(function (port, name) {
                return boolToPromise(port.canActivate(instruction.viewports[name]));
            }); },
            function (instruction) { return instruction.router.activatePorts(instruction); }
        ];
    }
    Pipeline.prototype.process = function (instruction) {
        // make a copy
        var steps = this.steps.slice(0);
        function processOne(result) {
            if (steps.length === 0) {
                return result;
            }
            var step = steps.shift();
            return $q.when(step(instruction)).then(processOne);
        }
        return processOne(null);
    };
    return Pipeline;
})();

///  <reference path="../typings/angularjs/angular.d.ts" />
///  <reference path="../typings/angularjs/angular-animate.d.ts" />
'use strict';
/*
 * A module for adding new a routing system Angular 1.
 */
angular.module('ngNewRouter', []).factory('$router', routerFactory).value('$routeParams', {}).provider('$componentLoader', $componentLoaderProvider).provider('$pipeline', pipelineProvider).factory('$$pipeline', privatePipelineFactory).factory('$setupRoutersStep', setupRoutersStepFactory).factory('$initLocalsStep', initLocalsStepFactory).factory('$initControllersStep', initControllersStepFactory).factory('$runCanDeactivateHookStep', runCanDeactivateHookStepFactory).factory('$runCanActivateHookStep', runCanActivateHookStepFactory).factory('$loadTemplatesStep', loadTemplatesStepFactory).value('$activateStep', activateStepValue).directive('ngViewport', ngViewportDirective).directive('ngViewport', ngViewportFillContentDirective).directive('ngLink', ngLinkDirective).directive('a', anchorLinkDirective);
/*
 * A module for inspecting controller constructors
 */
angular.module('ng').provider('$controllerIntrospector', $controllerIntrospectorProvider).config(controllerProviderDecorator);
/*
 * decorates with routing info
 */
function controllerProviderDecorator($controllerProvider, $controllerIntrospectorProvider) {
    var register = $controllerProvider.register;
    $controllerProvider.register = function (name, ctrl) {
        $controllerIntrospectorProvider.register(name, ctrl);
        return register.apply(this, arguments);
    };
}
controllerProviderDecorator.$inject = ["$controllerProvider", "$controllerIntrospectorProvider"];
/*
 * private service that holds route mappings for each controller
 */
function $controllerIntrospectorProvider() {
    var controllers = [];
    var onControllerRegistered = null;
    return {
        register: function (name, constructor) {
            if (angular.isArray(constructor)) {
                constructor = constructor[constructor.length - 1];
            }
            if (constructor.$routeConfig) {
                if (onControllerRegistered) {
                    onControllerRegistered(name, constructor.$routeConfig);
                }
                else {
                    controllers.push({ name: name, config: constructor.$routeConfig });
                }
            }
        },
        $get: ['$componentLoader', function ($componentLoader) {
            return function (newOnControllerRegistered) {
                onControllerRegistered = function (name, constructor) {
                    name = $componentLoader.component(name);
                    return newOnControllerRegistered(name, constructor);
                };
                while (controllers.length > 0) {
                    var rule = controllers.pop();
                    onControllerRegistered(rule.name, rule.config);
                }
            };
        }]
    };
}
function routerFactory($$rootRouter, $rootScope, $location, $$grammar, $controllerIntrospector) {
    $controllerIntrospector(function (name, config) {
        $$grammar.config(name, config);
    });
    $rootScope.$watch(function () {
        return $location.path();
    }, function (newUrl) {
        $$rootRouter.navigate(newUrl);
    });
    var nav = $$rootRouter.navigate;
    $$rootRouter.navigate = function (url) {
        return nav.call(this, url).then(function (newUrl) {
            if (newUrl) {
                $location.path(newUrl);
            }
        });
    };
    return $$rootRouter;
}
routerFactory.$inject = ["$$rootRouter", "$rootScope", "$location", "$$grammar", "$controllerIntrospector"];
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
function ngViewportDirective($animate, $injector, $q, $router) {
    var rootRouter = $router;
    return {
        restrict: 'AE',
        transclude: 'element',
        terminal: true,
        priority: 400,
        require: ['?^^ngViewport', 'ngViewport'],
        link: viewportLink,
        controller: function () {
        },
        controllerAs: '$$ngViewport'
    };
    function invoke(method, context, instruction) {
        return $injector.invoke(method, context, instruction.locals);
    }
    function viewportLink(scope, $element, attrs, ctrls, $transclude) {
        var viewportName = attrs['ngViewport'] || 'default', parentCtrl = ctrls[0], myCtrl = ctrls[1], router = (parentCtrl && parentCtrl.$$router) || rootRouter;
        var currentScope, newScope, currentController, currentElement, previousLeaveAnimation, previousInstruction;
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
                previousLeaveAnimation.then(function () {
                    previousLeaveAnimation = null;
                });
                currentElement = null;
            }
        }
        router.registerViewport({
            canDeactivate: function (instruction) {
                if (currentController && currentController.canDeactivate) {
                    return invoke(currentController.canDeactivate, currentController, instruction);
                }
                return true;
            },
            activate: function (instruction) {
                var nextInstruction = serializeInstruction(instruction);
                if (nextInstruction === previousInstruction) {
                    return;
                }
                instruction.locals.$scope = newScope = scope.$new();
                myCtrl.$$router = instruction.router;
                myCtrl.$$template = instruction.template;
                var componentName = instruction.component;
                var clone = $transclude(newScope, function (clone) {
                    $animate.enter(clone, null, currentElement || $element);
                    cleanupLastView();
                });
                var newController = instruction.controller;
                newScope[componentName] = newController;
                var result;
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
                    }
                    else {
                        return activationResult;
                    }
                }
                return result;
            }
        }, viewportName);
    }
    // TODO: how best to serialize?
    function serializeInstruction(instruction) {
        return JSON.stringify({
            path: instruction.path,
            component: instruction.component,
            params: Object.keys(instruction.params).reduce(function (acc, key) {
                return (key !== 'childRoute' && (acc[key] = instruction.params[key])), acc;
            }, {})
        });
    }
}
ngViewportDirective.$inject = ["$animate", "$injector", "$q", "$router"];
function ngViewportFillContentDirective($compile) {
    return {
        restrict: 'EA',
        priority: -400,
        require: 'ngViewport',
        link: function (scope, $element, attrs, ctrl) {
            var template = ctrl.$$template;
            $element.html(template);
            var link = $compile($element.contents());
            link(scope);
        }
    };
}
ngViewportFillContentDirective.$inject = ["$compile"];
function makeComponentString(name) {
    return [
        '<router-component component-name="',
        name,
        '">',
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
function ngLinkDirective($router, $location, $parse) {
    var rootRouter = $router;
    return {
        require: '?^^ngViewport',
        restrict: 'A',
        link: ngLinkDirectiveLinkFn
    };
    function ngLinkDirectiveLinkFn(scope, elt, attrs, ctrl) {
        var router = (ctrl && ctrl.$$router) || rootRouter;
        if (!router) {
            return;
        }
        var link = attrs['ngLink'] || '';
        var parts = link.match(LINK_MICROSYNTAX_RE);
        var routeName = parts[1];
        var routeParams = parts[2];
        var url;
        if (routeParams) {
            var routeParamsGetter = $parse(routeParams);
            // we can avoid adding a watcher if it's a literal
            if (routeParamsGetter.constant) {
                var params = routeParamsGetter();
                url = '.' + router.generate(routeName, params);
                elt.attr('href', url);
            }
            else {
                scope.$watch(function () {
                    return routeParamsGetter(scope);
                }, function (params) {
                    url = '.' + router.generate(routeName, params);
                    elt.attr('href', url);
                }, true);
            }
        }
        else {
            url = '.' + router.generate(routeName);
            elt.attr('href', url);
        }
    }
}
ngLinkDirective.$inject = ["$router", "$location", "$parse"];
function anchorLinkDirective($router) {
    return {
        restrict: 'E',
        link: function (scope, element) {
            // If the linked element is not an anchor tag anymore, do nothing
            if (element[0].nodeName.toLowerCase() !== 'a')
                return;
            // SVGAElement does not use the href attribute, but rather the 'xlinkHref' attribute.
            var hrefAttrName = Object.prototype.toString.call(element.prop('href')) === '[object SVGAnimatedString]' ? 'xlink:href' : 'href';
            element.on('click', function (event) {
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
    };
}
anchorLinkDirective.$inject = ["$router"];
function setupRoutersStepFactory() {
    return function (instruction) {
        return instruction.router.makeDescendantRouters(instruction);
    };
}
/*
 * $initLocalsStep
 */
function initLocalsStepFactory() {
    return function initLocals(instruction) {
        return instruction.router.traverseInstruction(instruction, function (instruction) {
            instruction.locals = {
                $router: instruction.router,
                $routeParams: (instruction.params || {})
            };
            return;
        });
    };
}
/*
 * $initControllersStep
 */
function initControllersStepFactory($controller, $componentLoader) {
    return function initControllers(instruction) {
        return instruction.router.traverseInstruction(instruction, function (instruction) {
            var controllerName = $componentLoader.controllerName(instruction.component);
            var locals = instruction.locals;
            var ctrl;
            try {
                ctrl = $controller(controllerName, locals);
            }
            catch (e) {
                console.warn && console.warn('Could not instantiate controller', controllerName);
                ctrl = $controller(angular.noop, locals);
            }
            return instruction.controller = ctrl;
        });
    };
}
initControllersStepFactory.$inject = ["$controller", "$componentLoader"];
function runCanDeactivateHookStepFactory() {
    return function runCanDeactivateHook(instruction) {
        return instruction.router.canDeactivatePorts(instruction);
    };
}
function runCanActivateHookStepFactory($injector) {
    function invoke(method, context, instruction) {
        return $injector.invoke(method, context, {
            $routeParams: instruction.params
        });
    }
    return function runCanActivateHook(instruction) {
        return instruction.router.traverseInstruction(instruction, function (instruction) {
            var controller = instruction.controller;
            return !controller.canActivate || invoke(controller.canActivate, controller, instruction);
        });
    };
}
runCanActivateHookStepFactory.$inject = ["$injector"];
function loadTemplatesStepFactory($componentLoader, $templateRequest) {
    return function loadTemplates(instruction) {
        return instruction.router.traverseInstruction(instruction, function (instruction) {
            var componentTemplateUrl = $componentLoader.template(instruction.component);
            return $templateRequest(componentTemplateUrl).then(function (templateHtml) {
                return instruction.template = templateHtml;
            });
        });
    };
}
loadTemplatesStepFactory.$inject = ["$componentLoader", "$templateRequest"];
function activateStepValue(instruction) {
    return instruction.router.activatePorts(instruction);
}
function pipelineProvider() {
    var stepConfiguration;
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
        config: function (newConfig) {
            protoStepConfiguration = newConfig;
        },
        $get: ["$injector", "$q", function ($injector, $q) {
            stepConfiguration = protoStepConfiguration.map(function (step) {
                return $injector.get(step);
            });
            return {
                process: function (instruction) {
                    // make a copy
                    var steps = stepConfiguration.slice(0);
                    function processOne(result) {
                        if (steps.length === 0) {
                            return result;
                        }
                        var step = steps.shift();
                        return $q.when(step(instruction)).then(processOne);
                    }
                    return processOne(null);
                }
            };
        }]
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
    var componentToCtrl = function componentToCtrlDefault(name) {
        return name[0].toUpperCase() + name.substr(1) + DEFAULT_SUFFIX;
    };
    var componentToTemplate = function componentToTemplateDefault(name) {
        var dashName = dashCase(name);
        return './components/' + dashName + '/' + dashName + '.html';
    };
    var ctrlToComponent = function ctrlToComponentDefault(name) {
        return name[0].toLowerCase() + name.substr(1, name.length - DEFAULT_SUFFIX.length - 1);
    };
    return {
        $get: function () {
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
        setCtrlNameMapping: function (newFn) {
            componentToCtrl = newFn;
            return this;
        },
        /**
         * @name $componentLoaderProvider#setCtrlNameMapping
         * @description takes a function for mapping component controller names to component names
         */
        setComponentFromCtrlMapping: function (newFn) {
            ctrlToComponent = newFn;
            return this;
        },
        /**
         * @name $componentLoaderProvider#setTemplateMapping
         * @description takes a function for mapping component names to component template URLs
         */
        setTemplateMapping: function (newFn) {
            componentToTemplate = newFn;
            return this;
        }
    };
}
// this is a hack as a result of the build system used to transpile
function privatePipelineFactory($pipeline) {
    return $pipeline;
}
privatePipelineFactory.$inject = ["$pipeline"];
function dashCase(str) {
    return str.replace(/([A-Z])/g, function ($1) {
        return '-' + $1.toLowerCase();
    });
}

// Type definitions for RouteRecognizer 0.1.4
// Project: https://github.com/tildeio/route-recognizer

var __extends = this.__extends || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    __.prototype = b.prototype;
    d.prototype = new __();
};
/**
 * @name Router
 * @where shared
 * @description
 * The router is responsible for mapping URLs to components.
 *
 * You can see the state of the router by inspecting the read-only field `router.navigating`.
 * This may be useful for showing a spinner, for instance.
 */
var Router = (function () {
    function Router(grammar, pipeline, parent, name) {
        this.name = name;
        this.parent = parent || null;
        this.navigating = false;
        this.ports = {};
        this.children = {};
        this.registry = grammar;
        this.pipeline = pipeline;
    }
    /**
     * @description
     * Constructs a child router.
     * You probably don't need to use this unless you're writing a reusable component.
     */
    Router.prototype.childRouter = function (name) {
        if (name === void 0) { name = 'default'; }
        if (!this.children[name]) {
            this.children[name] = new ChildRouter(this, name);
        }
        return this.children[name];
    };
    /**
     * @description
     * Register an object to notify of route changes.
     * You probably don't need to use this unless you're writing a reusable component.
     */
    Router.prototype.registerViewport = function (view, name) {
        if (name === void 0) { name = 'default'; }
        this.ports[name] = view;
        return this.renavigate();
    };
    /**
     * @description
     * Update the routing configuation and trigger a navigation.
     *
     * ```js
     * router.config({ path: '/', component: '/user' });
     * ```
     *
     * For more, see the [configuration](configuration) guide.
     */
    Router.prototype.config = function (mapping) {
        this.registry.config(this.name, mapping);
        return this.renavigate();
    };
    /**
     * @description Navigate to a URL.
     * Returns the cannonical URL for the route navigated to.
     */
    Router.prototype.navigate = function (url) {
        var _this = this;
        if (this.navigating) {
            return $q.when();
        }
        this.lastNavigationAttempt = url;
        var instruction = this.recognize(url);
        if (!instruction) {
            return $q.reject(null);
        }
        this._startNavigating();
        instruction.router = this;
        return this.pipeline.process(instruction).then(function () { return _this._finishNavigating(); }, function () { return _this._finishNavigating(); }).then(function () { return instruction.canonicalUrl; });
    };
    Router.prototype._startNavigating = function () {
        this.navigating = true;
    };
    Router.prototype._finishNavigating = function () {
        this.navigating = false;
    };
    Router.prototype.makeDescendantRouters = function (instruction) {
        this.traverseInstructionSync(instruction, function (instruction, childInstruction) {
            childInstruction.router = instruction.router.childRouter(childInstruction.component);
        });
    };
    Router.prototype.traverseInstructionSync = function (instruction, fn) {
        var _this = this;
        forEach(instruction.viewports, function (childInstruction, viewportName) { return fn(instruction, childInstruction); });
        forEach(instruction.viewports, function (childInstruction) { return _this.traverseInstructionSync(childInstruction, fn); });
    };
    Router.prototype.traverseInstruction = function (instruction, fn) {
        if (!instruction) {
            return $q.when();
        }
        return mapObjAsync(instruction.viewports, function (childInstruction, viewportName) { return boolToPromise(fn(childInstruction, viewportName)); }).then(function () { return mapObjAsync(instruction.viewports, function (childInstruction, viewportName) {
            return childInstruction.router.traverseInstruction(childInstruction, fn);
        }); });
    };
    /*
     * given a instruction obj
     * update viewports accordingly
     */
    Router.prototype.activatePorts = function (instruction) {
        return this.queryViewports(function (port, name) {
            return port.activate(instruction.viewports[name]);
        }).then(function () { return mapObjAsync(instruction.viewports, function (instruction) {
            return instruction.router.activatePorts(instruction);
        }); });
    };
    /*
     * given a instruction obj
     * update viewports accordingly
     */
    Router.prototype.canDeactivatePorts = function (instruction) {
        return this.traversePorts(function (port, name) {
            return boolToPromise(port.canDeactivate(instruction.viewports[name]));
        });
    };
    Router.prototype.traversePorts = function (fn) {
        var _this = this;
        return this.queryViewports(fn).then(function () { return mapObjAsync(_this.children, function (child) { return child.traversePorts(fn); }); });
    };
    Router.prototype.queryViewports = function (fn) {
        return mapObjAsync(this.ports, fn);
    };
    Router.prototype.recognize = function (url) {
        return this.registry.recognize(url);
    };
    /**
     * @description Navigates to either the last URL successfully naviagted to,
     * or the last URL requested if the router has yet to successfully navigate.
     * You shouldn't need to use this API very often.
     */
    Router.prototype.renavigate = function () {
        var renavigateDestination = this.previousUrl || this.lastNavigationAttempt;
        if (!this.navigating && renavigateDestination) {
            return this.navigate(renavigateDestination);
        }
        else {
            return $q.when();
        }
    };
    /**
     * @description generate a URL from a component name and optional map of parameters.
     * The URL is relative to the app's base href.
     */
    Router.prototype.generate = function (name, params) {
        return this.registry.generate(name, params);
    };
    return Router;
})();
var RootRouter = (function (_super) {
    __extends(RootRouter, _super);
    function RootRouter(grammar, pipeline) {
        _super.call(this, grammar, pipeline, null, '/');
    }
    return RootRouter;
})(Router);
var ChildRouter = (function (_super) {
    __extends(ChildRouter, _super);
    function ChildRouter(parent, name) {
        _super.call(this, parent.registry, parent.pipeline, parent, name);
        this.parent = parent;
    }
    return ChildRouter;
})(Router);

function copy(obj) {
    return JSON.parse(JSON.stringify(obj));
}
function forEach(obj, fn) {
    Object.keys(obj).forEach(function (key) { return fn(obj[key], key); });
}
function mapObj(obj, fn) {
    var result = [];
    Object.keys(obj).forEach(function (key) { return result.push(fn(obj[key], key)); });
    return result;
}
function mapObjAsync(obj, fn) {
    return $q.all(mapObj(obj, fn));
}
function boolToPromise(value) {
    return value ? $q.when(value) : $q.reject(null);
}

(function() {
    "use strict";
    function $$route$recognizer$dsl$$Target(path, matcher, delegate) {
      this.path = path;
      this.matcher = matcher;
      this.delegate = delegate;
    }

    $$route$recognizer$dsl$$Target.prototype = {
      to: function(target, callback) {
        var delegate = this.delegate;

        if (delegate && delegate.willAddRoute) {
          target = delegate.willAddRoute(this.matcher.target, target);
        }

        this.matcher.add(this.path, target);

        if (callback) {
          if (callback.length === 0) { throw new Error("You must have an argument in the function passed to `to`"); }
          this.matcher.addChild(this.path, target, callback, this.delegate);
        }
        return this;
      }
    };

    function $$route$recognizer$dsl$$Matcher(target) {
      this.routes = {};
      this.children = {};
      this.target = target;
    }

    $$route$recognizer$dsl$$Matcher.prototype = {
      add: function(path, handler) {
        this.routes[path] = handler;
      },

      addChild: function(path, target, callback, delegate) {
        var matcher = new $$route$recognizer$dsl$$Matcher(target);
        this.children[path] = matcher;

        var match = $$route$recognizer$dsl$$generateMatch(path, matcher, delegate);

        if (delegate && delegate.contextEntered) {
          delegate.contextEntered(target, match);
        }

        callback(match);
      }
    };

    function $$route$recognizer$dsl$$generateMatch(startingPath, matcher, delegate) {
      return function(path, nestedCallback) {
        var fullPath = startingPath + path;

        if (nestedCallback) {
          nestedCallback($$route$recognizer$dsl$$generateMatch(fullPath, matcher, delegate));
        } else {
          return new $$route$recognizer$dsl$$Target(startingPath + path, matcher, delegate);
        }
      };
    }

    function $$route$recognizer$dsl$$addRoute(routeArray, path, handler) {
      var len = 0;
      for (var i=0, l=routeArray.length; i<l; i++) {
        len += routeArray[i].path.length;
      }

      path = path.substr(len);
      var route = { path: path, handler: handler };
      routeArray.push(route);
    }

    function $$route$recognizer$dsl$$eachRoute(baseRoute, matcher, callback, binding) {
      var routes = matcher.routes;

      for (var path in routes) {
        if (routes.hasOwnProperty(path)) {
          var routeArray = baseRoute.slice();
          $$route$recognizer$dsl$$addRoute(routeArray, path, routes[path]);

          if (matcher.children[path]) {
            $$route$recognizer$dsl$$eachRoute(routeArray, matcher.children[path], callback, binding);
          } else {
            callback.call(binding, routeArray);
          }
        }
      }
    }

    var $$route$recognizer$dsl$$default = function(callback, addRouteCallback) {
      var matcher = new $$route$recognizer$dsl$$Matcher();

      callback($$route$recognizer$dsl$$generateMatch("", matcher, this.delegate));

      $$route$recognizer$dsl$$eachRoute([], matcher, function(route) {
        if (addRouteCallback) { addRouteCallback(this, route); }
        else { this.add(route); }
      }, this);
    };

    var $$route$recognizer$$specials = [
      '/', '.', '*', '+', '?', '|',
      '(', ')', '[', ']', '{', '}', '\\'
    ];

    var $$route$recognizer$$escapeRegex = new RegExp('(\\' + $$route$recognizer$$specials.join('|\\') + ')', 'g');

    function $$route$recognizer$$isArray(test) {
      return Object.prototype.toString.call(test) === "[object Array]";
    }

    // A Segment represents a segment in the original route description.
    // Each Segment type provides an `eachChar` and `regex` method.
    //
    // The `eachChar` method invokes the callback with one or more character
    // specifications. A character specification consumes one or more input
    // characters.
    //
    // The `regex` method returns a regex fragment for the segment. If the
    // segment is a dynamic of star segment, the regex fragment also includes
    // a capture.
    //
    // A character specification contains:
    //
    // * `validChars`: a String with a list of all valid characters, or
    // * `invalidChars`: a String with a list of all invalid characters
    // * `repeat`: true if the character specification can repeat

    function $$route$recognizer$$StaticSegment(string) { this.string = string; }
    $$route$recognizer$$StaticSegment.prototype = {
      eachChar: function(callback) {
        var string = this.string, ch;

        for (var i=0, l=string.length; i<l; i++) {
          ch = string.charAt(i);
          callback({ validChars: ch });
        }
      },

      regex: function() {
        return this.string.replace($$route$recognizer$$escapeRegex, '\\$1');
      },

      generate: function() {
        return this.string;
      }
    };

    function $$route$recognizer$$DynamicSegment(name) { this.name = name; }
    $$route$recognizer$$DynamicSegment.prototype = {
      eachChar: function(callback) {
        callback({ invalidChars: "/", repeat: true });
      },

      regex: function() {
        return "([^/]+)";
      },

      generate: function(params) {
        return params[this.name];
      }
    };

    function $$route$recognizer$$StarSegment(name) { this.name = name; }
    $$route$recognizer$$StarSegment.prototype = {
      eachChar: function(callback) {
        callback({ invalidChars: "", repeat: true });
      },

      regex: function() {
        return "(.+)";
      },

      generate: function(params) {
        return params[this.name];
      }
    };

    function $$route$recognizer$$EpsilonSegment() {}
    $$route$recognizer$$EpsilonSegment.prototype = {
      eachChar: function() {},
      regex: function() { return ""; },
      generate: function() { return ""; }
    };

    function $$route$recognizer$$parse(route, names, types) {
      // normalize route as not starting with a "/". Recognition will
      // also normalize.
      if (route.charAt(0) === "/") { route = route.substr(1); }

      var segments = route.split("/"), results = [];

      for (var i=0, l=segments.length; i<l; i++) {
        var segment = segments[i], match;

        if (match = segment.match(/^:([^\/]+)$/)) {
          results.push(new $$route$recognizer$$DynamicSegment(match[1]));
          names.push(match[1]);
          types.dynamics++;
        } else if (match = segment.match(/^\*([^\/]+)$/)) {
          results.push(new $$route$recognizer$$StarSegment(match[1]));
          names.push(match[1]);
          types.stars++;
        } else if(segment === "") {
          results.push(new $$route$recognizer$$EpsilonSegment());
        } else {
          results.push(new $$route$recognizer$$StaticSegment(segment));
          types.statics++;
        }
      }

      return results;
    }

    // A State has a character specification and (`charSpec`) and a list of possible
    // subsequent states (`nextStates`).
    //
    // If a State is an accepting state, it will also have several additional
    // properties:
    //
    // * `regex`: A regular expression that is used to extract parameters from paths
    //   that reached this accepting state.
    // * `handlers`: Information on how to convert the list of captures into calls
    //   to registered handlers with the specified parameters
    // * `types`: How many static, dynamic or star segments in this route. Used to
    //   decide which route to use if multiple registered routes match a path.
    //
    // Currently, State is implemented naively by looping over `nextStates` and
    // comparing a character specification against a character. A more efficient
    // implementation would use a hash of keys pointing at one or more next states.

    function $$route$recognizer$$State(charSpec) {
      this.charSpec = charSpec;
      this.nextStates = [];
    }

    $$route$recognizer$$State.prototype = {
      get: function(charSpec) {
        var nextStates = this.nextStates;

        for (var i=0, l=nextStates.length; i<l; i++) {
          var child = nextStates[i];

          var isEqual = child.charSpec.validChars === charSpec.validChars;
          isEqual = isEqual && child.charSpec.invalidChars === charSpec.invalidChars;

          if (isEqual) { return child; }
        }
      },

      put: function(charSpec) {
        var state;

        // If the character specification already exists in a child of the current
        // state, just return that state.
        if (state = this.get(charSpec)) { return state; }

        // Make a new state for the character spec
        state = new $$route$recognizer$$State(charSpec);

        // Insert the new state as a child of the current state
        this.nextStates.push(state);

        // If this character specification repeats, insert the new state as a child
        // of itself. Note that this will not trigger an infinite loop because each
        // transition during recognition consumes a character.
        if (charSpec.repeat) {
          state.nextStates.push(state);
        }

        // Return the new state
        return state;
      },

      // Find a list of child states matching the next character
      match: function(ch) {
        // DEBUG "Processing `" + ch + "`:"
        var nextStates = this.nextStates,
            child, charSpec, chars;

        // DEBUG "  " + debugState(this)
        var returned = [];

        for (var i=0, l=nextStates.length; i<l; i++) {
          child = nextStates[i];

          charSpec = child.charSpec;

          if (typeof (chars = charSpec.validChars) !== 'undefined') {
            if (chars.indexOf(ch) !== -1) { returned.push(child); }
          } else if (typeof (chars = charSpec.invalidChars) !== 'undefined') {
            if (chars.indexOf(ch) === -1) { returned.push(child); }
          }
        }

        return returned;
      }

      /** IF DEBUG
      , debug: function() {
        var charSpec = this.charSpec,
            debug = "[",
            chars = charSpec.validChars || charSpec.invalidChars;

        if (charSpec.invalidChars) { debug += "^"; }
        debug += chars;
        debug += "]";

        if (charSpec.repeat) { debug += "+"; }

        return debug;
      }
      END IF **/
    };

    /** IF DEBUG
    function debug(log) {
      console.log(log);
    }

    function debugState(state) {
      return state.nextStates.map(function(n) {
        if (n.nextStates.length === 0) { return "( " + n.debug() + " [accepting] )"; }
        return "( " + n.debug() + " <then> " + n.nextStates.map(function(s) { return s.debug() }).join(" or ") + " )";
      }).join(", ")
    }
    END IF **/

    // This is a somewhat naive strategy, but should work in a lot of cases
    // A better strategy would properly resolve /posts/:id/new and /posts/edit/:id.
    //
    // This strategy generally prefers more static and less dynamic matching.
    // Specifically, it
    //
    //  * prefers fewer stars to more, then
    //  * prefers using stars for less of the match to more, then
    //  * prefers fewer dynamic segments to more, then
    //  * prefers more static segments to more
    function $$route$recognizer$$sortSolutions(states) {
      return states.sort(function(a, b) {
        if (a.types.stars !== b.types.stars) { return a.types.stars - b.types.stars; }

        if (a.types.stars) {
          if (a.types.statics !== b.types.statics) { return b.types.statics - a.types.statics; }
          if (a.types.dynamics !== b.types.dynamics) { return b.types.dynamics - a.types.dynamics; }
        }

        if (a.types.dynamics !== b.types.dynamics) { return a.types.dynamics - b.types.dynamics; }
        if (a.types.statics !== b.types.statics) { return b.types.statics - a.types.statics; }

        return 0;
      });
    }

    function $$route$recognizer$$recognizeChar(states, ch) {
      var nextStates = [];

      for (var i=0, l=states.length; i<l; i++) {
        var state = states[i];

        nextStates = nextStates.concat(state.match(ch));
      }

      return nextStates;
    }

    var $$route$recognizer$$oCreate = Object.create || function(proto) {
      function F() {}
      F.prototype = proto;
      return new F();
    };

    function $$route$recognizer$$RecognizeResults(queryParams) {
      this.queryParams = queryParams || {};
    }
    $$route$recognizer$$RecognizeResults.prototype = $$route$recognizer$$oCreate({
      splice: Array.prototype.splice,
      slice:  Array.prototype.slice,
      push:   Array.prototype.push,
      length: 0,
      queryParams: null
    });

    function $$route$recognizer$$findHandler(state, path, queryParams) {
      var handlers = state.handlers, regex = state.regex;
      var captures = path.match(regex), currentCapture = 1;
      var result = new $$route$recognizer$$RecognizeResults(queryParams);

      for (var i=0, l=handlers.length; i<l; i++) {
        var handler = handlers[i], names = handler.names, params = {};

        for (var j=0, m=names.length; j<m; j++) {
          params[names[j]] = captures[currentCapture++];
        }

        result.push({ handler: handler.handler, params: params, isDynamic: !!names.length });
      }

      return result;
    }

    function $$route$recognizer$$addSegment(currentState, segment) {
      segment.eachChar(function(ch) {
        var state;

        currentState = currentState.put(ch);
      });

      return currentState;
    }

    // The main interface

    var $$route$recognizer$$RouteRecognizer = function() {
      this.rootState = new $$route$recognizer$$State();
      this.names = {};
    };


    $$route$recognizer$$RouteRecognizer.prototype = {
      add: function(routes, options) {
        var currentState = this.rootState, regex = "^",
            types = { statics: 0, dynamics: 0, stars: 0 },
            handlers = [], allSegments = [], name;

        var isEmpty = true;

        for (var i=0, l=routes.length; i<l; i++) {
          var route = routes[i], names = [];

          var segments = $$route$recognizer$$parse(route.path, names, types);

          allSegments = allSegments.concat(segments);

          for (var j=0, m=segments.length; j<m; j++) {
            var segment = segments[j];

            if (segment instanceof $$route$recognizer$$EpsilonSegment) { continue; }

            isEmpty = false;

            // Add a "/" for the new segment
            currentState = currentState.put({ validChars: "/" });
            regex += "/";

            // Add a representation of the segment to the NFA and regex
            currentState = $$route$recognizer$$addSegment(currentState, segment);
            regex += segment.regex();
          }

          var handler = { handler: route.handler, names: names };
          handlers.push(handler);
        }

        if (isEmpty) {
          currentState = currentState.put({ validChars: "/" });
          regex += "/";
        }

        currentState.handlers = handlers;
        currentState.regex = new RegExp(regex + "$");
        currentState.types = types;

        if (name = options && options.as) {
          this.names[name] = {
            segments: allSegments,
            handlers: handlers
          };
        }
      },

      handlersFor: function(name) {
        var route = this.names[name], result = [];
        if (!route) { throw new Error("There is no route named " + name); }

        for (var i=0, l=route.handlers.length; i<l; i++) {
          result.push(route.handlers[i]);
        }

        return result;
      },

      hasRoute: function(name) {
        return !!this.names[name];
      },

      generate: function(name, params) {
        var route = this.names[name], output = "";
        if (!route) { throw new Error("There is no route named " + name); }

        var segments = route.segments;

        for (var i=0, l=segments.length; i<l; i++) {
          var segment = segments[i];

          if (segment instanceof $$route$recognizer$$EpsilonSegment) { continue; }

          output += "/";
          output += segment.generate(params);
        }

        if (output.charAt(0) !== '/') { output = '/' + output; }

        if (params && params.queryParams) {
          output += this.generateQueryString(params.queryParams, route.handlers);
        }

        return output;
      },

      generateQueryString: function(params, handlers) {
        var pairs = [];
        var keys = [];
        for(var key in params) {
          if (params.hasOwnProperty(key)) {
            keys.push(key);
          }
        }
        keys.sort();
        for (var i = 0, len = keys.length; i < len; i++) {
          key = keys[i];
          var value = params[key];
          if (value == null) {
            continue;
          }
          var pair = encodeURIComponent(key);
          if ($$route$recognizer$$isArray(value)) {
            for (var j = 0, l = value.length; j < l; j++) {
              var arrayPair = key + '[]' + '=' + encodeURIComponent(value[j]);
              pairs.push(arrayPair);
            }
          } else {
            pair += "=" + encodeURIComponent(value);
            pairs.push(pair);
          }
        }

        if (pairs.length === 0) { return ''; }

        return "?" + pairs.join("&");
      },

      parseQueryString: function(queryString) {
        var pairs = queryString.split("&"), queryParams = {};
        for(var i=0; i < pairs.length; i++) {
          var pair      = pairs[i].split('='),
              key       = decodeURIComponent(pair[0]),
              keyLength = key.length,
              isArray = false,
              value;
          if (pair.length === 1) {
            value = 'true';
          } else {
            //Handle arrays
            if (keyLength > 2 && key.slice(keyLength -2) === '[]') {
              isArray = true;
              key = key.slice(0, keyLength - 2);
              if(!queryParams[key]) {
                queryParams[key] = [];
              }
            }
            value = pair[1] ? decodeURIComponent(pair[1]) : '';
          }
          if (isArray) {
            queryParams[key].push(value);
          } else {
            queryParams[key] = value;
          }
        }
        return queryParams;
      },

      recognize: function(path) {
        var states = [ this.rootState ],
            pathLen, i, l, queryStart, queryParams = {},
            isSlashDropped = false;

        queryStart = path.indexOf('?');
        if (queryStart !== -1) {
          var queryString = path.substr(queryStart + 1, path.length);
          path = path.substr(0, queryStart);
          queryParams = this.parseQueryString(queryString);
        }

        path = decodeURI(path);

        // DEBUG GROUP path

        if (path.charAt(0) !== "/") { path = "/" + path; }

        pathLen = path.length;
        if (pathLen > 1 && path.charAt(pathLen - 1) === "/") {
          path = path.substr(0, pathLen - 1);
          isSlashDropped = true;
        }

        for (i=0, l=path.length; i<l; i++) {
          states = $$route$recognizer$$recognizeChar(states, path.charAt(i));
          if (!states.length) { break; }
        }

        // END DEBUG GROUP

        var solutions = [];
        for (i=0, l=states.length; i<l; i++) {
          if (states[i].handlers) { solutions.push(states[i]); }
        }

        states = $$route$recognizer$$sortSolutions(solutions);

        var state = solutions[0];

        if (state && state.handlers) {
          // if a trailing slash was dropped and a star segment is the last segment
          // specified, put the trailing slash back
          if (isSlashDropped && state.regex.source.slice(-5) === "(.+)$") {
            path = path + "/";
          }
          return $$route$recognizer$$findHandler(state, path, queryParams);
        }
      }
    };

    $$route$recognizer$$RouteRecognizer.prototype.map = $$route$recognizer$dsl$$default;

    $$route$recognizer$$RouteRecognizer.VERSION = '0.1.4';

    var $$route$recognizer$$default = $$route$recognizer$$RouteRecognizer;

    /* global define:true module:true window: true */
    if (typeof define === 'function' && define['amd']) {
      define(function() { return $$route$recognizer$$default; });
    } else if (typeof module !== 'undefined' && module['exports']) {
      module['exports'] = $$route$recognizer$$default;
    } else if (typeof this !== 'undefined') {
      this['RouteRecognizer'] = $$route$recognizer$$default;
    }
}).call(this);

//# sourceMappingURL=route-recognizer.js.map