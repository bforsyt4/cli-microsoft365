import { Cli } from "../../../../cli/Cli.js";
import { Logger } from "../../../../cli/Logger.js";
import GlobalOptions from "../../../../GlobalOptions.js";
import request, { CliRequestOptions } from "../../../../request.js";
import { formatting } from "../../../../utils/formatting.js";
import GraphCommand from "../../../base/GraphCommand.js";
import commands from "../../commands.js";

interface CommandArgs {
  options: Options;
}

interface Options extends GlobalOptions {
  taskId: string;
}

class PlannerTaskChecklistItemListCommand extends GraphCommand {
  public get name(): string {
    return commands.TASK_CHECKLISTITEM_LIST;
  }

  public get description(): string {
    return 'Lists the checklist items of a Planner task.';
  }

  public defaultProperties(): string[] | undefined {
    return ['id', 'title', 'isChecked'];
  }

  constructor() {
    super();

    this.#initOptions();
  }

  #initOptions(): void {
    this.options.unshift(
      {
        option: "-i, --taskId <taskId>"
      }
    );
  }

  public async commandAction(logger: Logger, args: CommandArgs): Promise<void> {
    const requestOptions: CliRequestOptions = {
      url: `${this.resource}/v1.0/planner/tasks/${formatting.encodeQueryParameter(args.options.taskId)}/details?$select=checklist`,
      headers: {
        accept: "application/json;odata.metadata=none"
      },
      responseType: "json"
    };

    try {
      const res = await request.get<any>(requestOptions);
      if (!args.options.output || !Cli.shouldTrimOutput(args.options.output)) {
        await logger.log(res.checklist);
      }
      else {
        //converted to text friendly output
        const output = Object.getOwnPropertyNames(res.checklist).map(prop => ({ id: prop, ...(res.checklist as any)[prop] }));
        await logger.log(output);
      }
    }
    catch (err: any) {
      this.handleRejectedODataJsonPromise(err);
    }
  }
}

export default new PlannerTaskChecklistItemListCommand();