/// <reference path="../typings/es6-promise/es6-promise.d.ts" />


interface Instruction {
  canonicalUrl?: string;
  viewports: { [name: string]: Instruction };
  params?: recognizer.Params;
  component?: string;
  router?: IRouter;
}

interface IRouter {
  childRouter(name: string): IRouter;
  makeDescendantRouters(instruction: Instruction): void;
  canDeactivatePorts(instruction: Instruction): Promise<any>;
  traversePorts(fn: Function): Promise<any>;
  activatePorts(instrunction: Instruction): Promise<any>;
  traverseInstruction(instruction: Instruction, fn: Function):Promise<any>;
}

interface RewriteFunction extends Function {
  (name: string): string;
}

interface Mapping {
  redirectTo: RewriteFunction;
  path: string;
  component: string;
  components: any;
  as: string;
}

interface Port {
  activate(instruction: Instruction): Promise<any>;
  canDeactivate(instruction: Instruction): boolean;
  canActivate(instruction: Instruction): boolean;
}
