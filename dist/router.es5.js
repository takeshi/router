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
