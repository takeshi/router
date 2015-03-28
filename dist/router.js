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
            return Promise.resolve();
        }
        this.lastNavigationAttempt = url;
        var instruction = this.recognize(url);
        if (!instruction) {
            return Promise.reject(null);
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
            return Promise.resolve();
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
            return Promise.resolve();
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
