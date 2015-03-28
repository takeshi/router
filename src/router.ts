
/**
 * @name Router
 * @where shared
 * @description
 * The router is responsible for mapping URLs to components.
 */
class Router implements IRouter{
  name: string;
  parent: Router;
  navigating: boolean;
  ports: any;
  children: { [name: string]: Router };
  registry: Grammar;
  pipeline: Pipeline;
  lastNavigationAttempt: string;
  previousUrl: string;

  constructor(grammar: Grammar, pipeline: Pipeline, parent: Router, name: string) {
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
  childRouter(name = 'default') {
    if (!this.children[name]) {
      this.children[name] = new ChildRouter(this, name);
    }
    return this.children[name];
  }


  /**
   * @description
   * Register an object to notify of route changes.
   * You probably don't need to use this unless you're writing a reusable component.
   */
  registerViewport(view: Instruction, name = 'default') {
    this.ports[name] = view;
    return this.renavigate();
  }


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
  config(mapping: Mapping) {
    this.registry.config(this.name, mapping);
    return this.renavigate();
  }


  /**
   * @description Navigate to a URL.
   * Returns the cannonical URL for the route navigated to.
   */
  navigate(url: string) {
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
    return this.pipeline.process(instruction)
      .then(() => this._finishNavigating(),() => this._finishNavigating())
      .then(() => instruction.canonicalUrl);
  }

  _startNavigating() {
    this.navigating = true;
  }

  _finishNavigating() {
    this.navigating = false;
  }


  makeDescendantRouters(instruction: Instruction) {
    this.traverseInstructionSync(instruction,(instruction: Instruction, childInstruction: Instruction) => {
      childInstruction.router = instruction.router.childRouter(childInstruction.component);
    });
  }


  traverseInstructionSync(instruction: Instruction, fn: Function):void {
    forEach(instruction.viewports,
      (childInstruction: Instruction, viewportName: string) => fn(instruction, childInstruction));
    forEach(instruction.viewports,
      (childInstruction: Instruction) => this.traverseInstructionSync(childInstruction, fn));
  }


  traverseInstruction(instruction: Instruction, fn: Function):Promise<any> {
    if (!instruction) {
      return Promise.resolve();
    }
    return mapObjAsync(instruction.viewports,
      (childInstruction: Instruction, viewportName: string) => boolToPromise(fn(childInstruction, viewportName)))
      .then(() => mapObjAsync(instruction.viewports,(childInstruction: Instruction, viewportName: string) => {
      return childInstruction.router.traverseInstruction(childInstruction, fn);
    }));
  }


  /*
   * given a instruction obj
   * update viewports accordingly
   */
  activatePorts(instruction: Instruction): Promise<any> {
    return this.queryViewports((port: Port, name: string) => {
      return port.activate(instruction.viewports[name]);
    })
      .then(() => mapObjAsync(instruction.viewports,(instruction: Instruction) => {
      return instruction.router.activatePorts(instruction);
    }));
  }


  /*
   * given a instruction obj
   * update viewports accordingly
   */
  canDeactivatePorts(instruction: Instruction): Promise<any> {
    return this.traversePorts((port: Port, name: string) => {
      return boolToPromise(port.canDeactivate(instruction.viewports[name]));
    });
  }

  traversePorts(fn: Function): Promise<any> {
    return this.queryViewports(fn)
      .then(() => mapObjAsync(this.children,(child: Router) => child.traversePorts(fn)));
  }

  queryViewports(fn: Function) {
    return mapObjAsync(this.ports, fn);
  }


  recognize(url: string) {
    return this.registry.recognize(url);
  }



  /**
   * @description Navigates to either the last URL successfully naviagted to,
   * or the last URL requested if the router has yet to successfully navigate.
   * You shouldn't need to use this API very often.
   */
  renavigate() {
    var renavigateDestination = this.previousUrl || this.lastNavigationAttempt;
    if (!this.navigating && renavigateDestination) {
      return this.navigate(renavigateDestination);
    } else {
      return Promise.resolve();
    }
  }


  /**
   * @description generate a URL from a component name and optional map of parameters.
   * The URL is relative to the app's base href.
   */
  generate(name: string, params: recognizer.Params) {
    return this.registry.generate(name, params);
  }

}

class RootRouter extends Router {
  constructor(grammar: Grammar, pipeline: Pipeline) {
    super(grammar, pipeline, null, '/');
  }
}

class ChildRouter extends Router {
  constructor(parent: Router, name: string) {
    super(parent.registry, parent.pipeline, parent, name);
    this.parent = parent;
  }
}
