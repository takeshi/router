
class Pipeline {
  steps: Function[];
  constructor() {
    this.steps = [
      (instruction: Instruction) => instruction.router.makeDescendantRouters(instruction),
      (instruction: Instruction) => instruction.router.canDeactivatePorts(instruction),
      (instruction: Instruction) => instruction.router.traversePorts((port: Port, name: string) => {
        return boolToPromise(port.canActivate(instruction.viewports[name]));
      }),
      (instruction: Instruction) => instruction.router.activatePorts(instruction)
    ];
  }
  process(instruction: Instruction) {
    // make a copy
    var steps = this.steps.slice(0);

    function processOne(result:any):Promise<any> {
      if (steps.length === 0) {
        return result;
      }
      var step = steps.shift();
      return Promise.resolve(step(instruction)).then(processOne);
    }

    return processOne(null);
  }
}
