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
  id?: string;
  mailNickname?: string;
}

class AadM365GroupTeamifyCommand extends GraphCommand {
  public get name(): string {
    return commands.M365GROUP_TEAMIFY;
  }

  public get description(): string {
    return 'Creates a new Microsoft Teams team under existing Microsoft 365 group';
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
        id: typeof args.options.id !== 'undefined',
        mailNickname: typeof args.options.mailNickname !== 'undefined'
      });
    });
  }

  #initOptions(): void {
    this.options.unshift(
      {
        option: '-i, --id [id]'
      },
      {
        option: '--mailNickname [mailNickname]'
      }
    );
  }

  #initValidators(): void {
    this.validators.push(
      async (args: CommandArgs) => {
        if (args.options.id && !validation.isValidGuid(args.options.id)) {
          return `${args.options.id} is not a valid GUID`;
        }

        return true;
      }
    );
  }

  #initOptionSets(): void {
    this.optionSets.push({ options: ['id', 'mailNickname'] });
  }

  private async getGroupId(args: CommandArgs): Promise<string> {
    if (args.options.id) {
      return args.options.id;
    }

    const requestOptions: CliRequestOptions = {
      url: `${this.resource}/v1.0/groups?$filter=mailNickname eq '${formatting.encodeQueryParameter(args.options.mailNickname as string)}'`,
      headers: {
        accept: 'application/json;odata.metadata=none'
      },
      responseType: 'json'
    };

    const response = await request.get<{ value: [{ id: string }] }>(requestOptions);
    const groupItem: { id: string } | undefined = response.value[0];

    if (!groupItem) {
      throw `The specified Microsoft 365 Group does not exist`;
    }

    if (response.value.length > 1) {
      throw `Multiple Microsoft 365 Groups with name ${args.options.mailNickname} found: ${response.value.map(x => x.id)}`;
    }

    return groupItem.id;
  }

  public async commandAction(logger: Logger, args: CommandArgs): Promise<void> {
    try {
      const data: any = {
        "memberSettings": {
          "allowCreatePrivateChannels": true,
          "allowCreateUpdateChannels": true
        },
        "messagingSettings": {
          "allowUserEditMessages": true,
          "allowUserDeleteMessages": true
        },
        "funSettings": {
          "allowGiphy": true,
          "giphyContentRating": "strict"
        }
      };

      const groupId = await this.getGroupId(args);
      const requestOptions: CliRequestOptions = {
        url: `${this.resource}/v1.0/groups/${formatting.encodeQueryParameter(groupId)}/team`,
        headers: {
          accept: 'application/json;odata.metadata=none'
        },
        data: data,
        responseType: 'json'
      };

      await request.put(requestOptions);
    }
    catch (err: any) {
      this.handleRejectedODataJsonPromise(err);
    }
  }
}

export default new AadM365GroupTeamifyCommand();