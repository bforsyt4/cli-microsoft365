import { AadUserConversationMember, Chat, ConversationMember } from '@microsoft/microsoft-graph-types';
import os from 'os';
import auth from '../../../../Auth.js';
import { Logger } from '../../../../cli/Logger.js';
import GlobalOptions from '../../../../GlobalOptions.js';
import request, { CliRequestOptions } from '../../../../request.js';
import { accessToken } from '../../../../utils/accessToken.js';
import { validation } from '../../../../utils/validation.js';
import GraphCommand from '../../../base/GraphCommand.js';
import commands from '../../commands.js';
import { chatUtil } from './chatUtil.js';

interface CommandArgs {
  options: Options;
}

interface Options extends GlobalOptions {
  chatId?: string;
  userEmails?: string;
  chatName?: string;
  message: string;
}

class TeamsChatMessageSendCommand extends GraphCommand {
  public get name(): string {
    return commands.CHAT_MESSAGE_SEND;
  }

  public get description(): string {
    return 'Sends a chat message to a Microsoft Teams chat conversation.';
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
        chatId: typeof args.options.chatId !== 'undefined',
        userEmails: typeof args.options.userEmails !== 'undefined',
        chatName: typeof args.options.chatName !== 'undefined'
      });
    });
  }

  #initOptions(): void {
    this.options.unshift(
      {
        option: '--chatId [chatId]'
      },
      {
        option: '-e, --userEmails [userEmails]'
      },
      {
        option: '--chatName [chatName]'
      },
      {
        option: '-m, --message <message>'
      }
    );
  }

  #initValidators(): void {
    this.validators.push(
      async (args: CommandArgs) => {
        if (args.options.chatId && !validation.isValidTeamsChatId(args.options.chatId)) {
          return `${args.options.chatId} is not a valid Teams ChatId.`;
        }

        if (args.options.userEmails) {
          const userEmails = args.options.userEmails.trim().toLowerCase().split(',').filter(e => e && e !== '');
          if (!userEmails || userEmails.length === 0 || userEmails.some(e => !validation.isValidUserPrincipalName(e))) {
            return `${args.options.userEmails} contains one or more invalid email addresses.`;
          }
        }

        return true;
      }
    );
  }

  #initOptionSets(): void {
    this.optionSets.push({ options: ['chatId', 'userEmails', 'chatName'] });
  }

  public async commandAction(logger: Logger, args: CommandArgs): Promise<void> {
    try {
      const chatId = await this.getChatId(logger, args);
      await this.sendChatMessage(chatId as string, args);
    }
    catch (err: any) {
      this.handleRejectedODataJsonPromise(err);
    }
  }

  private async getChatId(logger: Logger, args: CommandArgs): Promise<string> {
    if (args.options.chatId) {
      return args.options.chatId;
    }

    return args.options.userEmails
      ? this.ensureChatIdByUserEmails(args.options.userEmails)
      : this.getChatIdByName(args.options.chatName as string);
  }

  private async ensureChatIdByUserEmails(userEmailsOption: string): Promise<string> {
    const userEmails = userEmailsOption.trim().toLowerCase().split(',').filter(e => e && e !== '');
    const currentUserEmail = accessToken.getUserNameFromAccessToken(auth.service.accessTokens[this.resource].accessToken).toLowerCase();
    const existingChats = await chatUtil.findExistingChatsByParticipants([currentUserEmail, ...userEmails]);

    if (!existingChats || existingChats.length === 0) {
      const chat = await this.createConversation([currentUserEmail, ...userEmails]);
      return chat.id as string;
    }

    if (existingChats.length === 1) {
      return existingChats[0].id as string;
    }

    const disambiguationText = existingChats.map(c => {
      return `- ${c.id}${c.topic && ' - '}${c.topic} - ${c.createdDateTime && new Date(c.createdDateTime).toLocaleString()}`;
    }).join(os.EOL);

    throw `Multiple chat conversations with this name found. Please disambiguate:${os.EOL}${disambiguationText}`;
  }

  private async getChatIdByName(chatName: string): Promise<string> {
    const existingChats = await chatUtil.findExistingGroupChatsByName(chatName);

    if (!existingChats || existingChats.length === 0) {
      throw 'No chat conversation was found with this name.';
    }

    if (existingChats.length === 1) {
      return existingChats[0].id as string;
    }

    const disambiguationText = existingChats.map(c => {
      const memberstring = (c.members as ConversationMember[]).map(m => (m as AadUserConversationMember).email).join(', ');
      return `- ${c.id} - ${c.createdDateTime && new Date(c.createdDateTime).toLocaleString()} - ${memberstring}`;
    }).join(os.EOL);

    throw `Multiple chat conversations with this name found. Please disambiguate:${os.EOL}${disambiguationText}`;
  }

  // This Microsoft Graph API request throws an intermittent 404 exception, saying that it cannot find the principal.
  // The same behavior occurs when creating the conversation through the Graph Explorer.
  // It seems to happen when the userEmail casing does not match the casing of the actual UPN. 
  // When the first request throws an error, the second request does succeed. 
  // Therefore a retry-mechanism is implemented here. 
  private async createConversation(memberEmails: string[], retried: number = 0): Promise<Chat> {
    try {
      const jsonBody = {
        chatType: memberEmails.length > 2 ? 'group' : 'oneOnOne',
        members: memberEmails.map(email => {
          return {
            '@odata.type': '#microsoft.graph.aadUserConversationMember',
            roles: ['owner'],
            'user@odata.bind': `https://graph.microsoft.com/v1.0/users/${email}`
          };
        })
      };

      const requestOptions: CliRequestOptions = {
        url: `${this.resource}/v1.0/chats`,
        headers: {
          accept: 'application/json;odata.metadata=none',
          'content-type': 'application/json;odata=nometadata'
        },
        responseType: 'json',
        data: jsonBody
      };

      return await request.post<Chat>(requestOptions);
    }
    catch (err) {
      if ((err as Error).message?.indexOf('404') > -1 && retried < 4) {
        return await this.createConversation(memberEmails, retried + 1);
      }

      throw err;
    }
  }

  private async sendChatMessage(chatId: string, args: CommandArgs): Promise<void> {
    const requestOptions: CliRequestOptions = {
      url: `${this.resource}/v1.0/chats/${chatId}/messages`,
      headers: {
        accept: 'application/json;odata.metadata=none',
        'content-type': 'application/json;odata=nometadata'
      },
      responseType: 'json',
      data: {
        body: {
          content: args.options.message
        }
      }
    };

    return request.post(requestOptions);
  }
}

export default new TeamsChatMessageSendCommand();