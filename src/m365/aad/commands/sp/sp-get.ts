import { Logger } from '../../../../cli/Logger.js';
import GlobalOptions from '../../../../GlobalOptions.js';
import request, { CliRequestOptions } from '../../../../request.js';
import { formatting } from '../../../../utils/formatting.js';
import { validation } from '../../../../utils/validation.js';
import GraphCommand from '../../../base/GraphCommand.js';
import commands from '../../commands.js';

interface CommandArgs {
  options: Options;
}

interface Options extends GlobalOptions {
  appId?: string;
  appDisplayName?: string;
  appObjectId?: string;
}

class AadSpGetCommand extends GraphCommand {
  public get name(): string {
    return commands.SP_GET;
  }

  public get description(): string {
    return 'Gets information about the specific service principal';
  }

  constructor() {
    super();

    this.#initTelemetry();
    this.#initOptions();
    this.#initValidators();
    this.#initOptionSets();
  }

  #initTelemetry(): void {
    this.telemetry.push((args: CommandArgs) => {
      Object.assign(this.telemetryProperties, {
        appId: (!(!args.options.appId)).toString(),
        appDisplayName: (!(!args.options.appDisplayName)).toString(),
        appObjectId: (!(!args.options.appObjectId)).toString()
      });
    });
  }

  #initOptions(): void {
    this.options.unshift(
      {
        option: '-i, --appId [appId]'
      },
      {
        option: '-n, --appDisplayName [appDisplayName]'
      },
      {
        option: '--appObjectId [appObjectId]'
      }
    );
  }

  #initValidators(): void {
    this.validators.push(
      async (args: CommandArgs) => {
        if (args.options.appId && !validation.isValidGuid(args.options.appId)) {
          return `${args.options.appId} is not a valid appId GUID`;
        }

        if (args.options.appObjectId && !validation.isValidGuid(args.options.appObjectId)) {
          return `${args.options.appObjectId} is not a valid objectId GUID`;
        }

        return true;
      }
    );
  }

  #initOptionSets(): void {
    this.optionSets.push({ options: ['appId', 'appDisplayName', 'appObjectId'] });
  }

  private async getSpId(args: CommandArgs): Promise<string> {
    if (args.options.appObjectId) {
      return args.options.appObjectId;
    }

    let spMatchQuery: string = '';
    if (args.options.appDisplayName) {
      spMatchQuery = `displayName eq '${formatting.encodeQueryParameter(args.options.appDisplayName)}'`;
    }
    else if (args.options.appId) {
      spMatchQuery = `appId eq '${formatting.encodeQueryParameter(args.options.appId)}'`;
    }

    const idRequestOptions: CliRequestOptions = {
      url: `${this.resource}/v1.0/servicePrincipals?$filter=${spMatchQuery}`,
      headers: {
        accept: 'application/json;odata.metadata=none'
      },
      responseType: 'json'
    };

    const response = await request.get<{ value: { id: string; }[] }>(idRequestOptions);

    const spItem: { id: string } | undefined = response.value[0];

    if (!spItem) {
      throw `The specified Azure AD app does not exist`;
    }

    if (response.value.length > 1) {
      throw `Multiple Azure AD apps with name ${args.options.appDisplayName} found: ${response.value.map(x => x.id)}`;
    }

    return spItem.id;
  }

  public async commandAction(logger: Logger, args: CommandArgs): Promise<void> {
    if (this.verbose) {
      await logger.logToStderr(`Retrieving service principal information...`);
    }

    try {
      const id = await this.getSpId(args);

      const requestOptions: CliRequestOptions = {
        url: `${this.resource}/v1.0/servicePrincipals/${id}`,
        headers: {
          accept: 'application/json;odata.metadata=none',
          'content-type': 'application/json;odata.metadata=none'
        },
        responseType: 'json'
      };

      const res = await request.get(requestOptions);
      await logger.log(res);
    }
    catch (err: any) {
      this.handleRejectedODataJsonPromise(err);
    }
  }
}

export default new AadSpGetCommand();