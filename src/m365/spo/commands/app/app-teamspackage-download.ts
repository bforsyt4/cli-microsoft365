import fs from 'fs';
import path from 'path';
import { Logger } from '../../../../cli/Logger.js';
import GlobalOptions from '../../../../GlobalOptions.js';
import request, { CliRequestOptions } from '../../../../request.js';
import { formatting } from '../../../../utils/formatting.js';
import { spo } from '../../../../utils/spo.js';
import { urlUtil } from '../../../../utils/urlUtil.js';
import { validation } from '../../../../utils/validation.js';
import commands from '../../commands.js';
import { SpoAppBaseCommand } from './SpoAppBaseCommand.js';

interface CommandArgs {
  options: Options;
}

interface Options extends GlobalOptions {
  appCatalogUrl?: string;
  appItemUniqueId?: string;
  appItemId?: number;
  appName?: string;
  fileName?: string;
}

interface AppInfo {
  // Item ID of the app in the app catalog
  id?: number;
  // File name of where the app package will be downloaded to (.zip)
  packageFileName?: string;
}

class SpoAppTeamsPackageDownloadCommand extends SpoAppBaseCommand {
  private appCatalogUrl?: string;

  public get name(): string {
    return commands.APP_TEAMSPACKAGE_DOWNLOAD;
  }

  public get description(): string {
    return 'Downloads Teams app package for an SPFx solution deployed to tenant app catalog';
  }

  constructor() {
    super();

    this.#initTelemetry();
    this.#initOptions();
    this.#initValidators();
  }

  #initTelemetry(): void {
    this.telemetry.push((args: CommandArgs) => {
      Object.assign(this.telemetryProperties, {
        appCatalogUrl: typeof args.options.appCatalogUrl !== 'undefined',
        appItemUniqueId: typeof args.options.appItemUniqueId !== 'undefined',
        appItemId: typeof args.options.appItemId !== 'undefined',
        appName: typeof args.options.appName !== 'undefined',
        fileName: typeof args.options.fileName !== 'undefined'
      });
    });
  }

  #initOptions(): void {
    this.options.unshift(
      { option: '--appItemId [appItemId]' },
      { option: '--appItemUniqueId [appItemUniqueId]' },
      { option: '--appName [appName]' },
      { option: '--fileName [fileName]' },
      { option: '-u, --appCatalogUrl [appCatalogUrl]' }
    );
  }

  #initValidators(): void {
    this.validators.push(
      async (args: CommandArgs) => {
        if (!args.options.appItemUniqueId &&
          !args.options.appItemId &&
          !args.options.appName) {
          return `Specify appItemUniqueId, appItemId or appName`;
        }

        if ((args.options.appItemUniqueId && args.options.appItemId) ||
          (args.options.appItemUniqueId && args.options.appName) ||
          (args.options.appItemId && args.options.appName)) {
          return `Specify appItemUniqueId, appItemId or appName but not multiple`;
        }

        if (args.options.appItemUniqueId &&
          !validation.isValidGuid(args.options.appItemUniqueId)) {
          return `${args.options.appItemUniqueId} is not a valid GUID`;
        }

        if (args.options.appItemId &&
          isNaN(args.options.appItemId)) {
          return `${args.options.appItemId} is not a number`;
        }

        if (args.options.fileName &&
          fs.existsSync(args.options.fileName)) {
          return `File ${args.options.fileName} already exists`;
        }

        if (args.options.appCatalogUrl) {
          return validation.isValidSharePointUrl(args.options.appCatalogUrl);
        }

        return true;
      }
    );
  }

  public async commandAction(logger: Logger, args: CommandArgs): Promise<void> {
    try {
      this.appCatalogUrl = args.options.appCatalogUrl;
      const appInfo: AppInfo = {
        id: args.options.appItemId ?? undefined,
        packageFileName: args.options.fileName ?? undefined
      };
      if (this.debug) {
        await logger.logToStderr(`appInfo: ${JSON.stringify(appInfo)}`);
      }

      await this.ensureAppInfo(logger, args, appInfo);

      if (this.debug) {
        await logger.logToStderr(`ensureAppInfo: ${JSON.stringify(appInfo)}`);
      }

      await this.loadAppCatalogUrl(logger, args);

      const requestOptions: CliRequestOptions = {
        url: `${this.appCatalogUrl}/_api/web/tenantappcatalog/downloadteamssolution(${appInfo.id})/$value`,
        headers: {
          accept: 'application/json;odata=nometadata'
        },
        responseType: 'stream'
      };

      const file = await request.get<any>(requestOptions);

      // Not possible to use async/await for this promise
      await new Promise<void>((resolve, reject) => {
        const writer = fs.createWriteStream(appInfo.packageFileName as string);

        file.data.pipe(writer);

        writer.on('error', err => {
          return reject(err);
        });
        writer.on('close', async () => {
          const fileName = appInfo.packageFileName as string;
          if (this.verbose) {
            await logger.logToStderr(`Package saved to ${fileName}`);
          }
          return resolve();
        });
      });
    }
    catch (err: any) {
      this.handleRejectedODataJsonPromise(err);
    }
  }

  private async ensureAppInfo(logger: Logger, args: CommandArgs, appInfo: AppInfo): Promise<void> {
    if (appInfo.id && appInfo.packageFileName) {
      return;
    }

    if (args.options.appName && !appInfo.packageFileName) {
      appInfo.packageFileName = this.getPackageNameFromFileName(args.options.appName);
    }

    await this.loadAppCatalogUrl(logger, args);
    const appCatalogListName = 'AppCatalog';
    const serverRelativeAppCatalogListUrl = `${urlUtil.getServerRelativeSiteUrl(this.appCatalogUrl as string)}/${appCatalogListName}`;

    let url: string = `${this.appCatalogUrl}/_api/web/`;
    if (args.options.appItemUniqueId) {
      url += `GetList('${serverRelativeAppCatalogListUrl}')/GetItemByUniqueId('${args.options.appItemUniqueId}')?$expand=File&$select=Id,File/Name`;
    }
    else if (args.options.appItemId) {
      url += `GetList('${serverRelativeAppCatalogListUrl}')/GetItemById(${args.options.appItemId})?$expand=File&$select=File/Name`;
    }
    else if (args.options.appName) {
      url += `getfolderbyserverrelativeurl('${appCatalogListName}')/files('${formatting.encodeQueryParameter(args.options.appName)}')/ListItemAllFields?$select=Id`;
    }

    const requestOptions: CliRequestOptions = {
      url,
      headers: {
        accept: 'application/json;odata=nometadata'
      },
      responseType: 'json'
    };
    const res = await request.get<{ Id?: string; File?: { Name: string; } }>(requestOptions);

    if (args.options.appItemUniqueId) {
      appInfo.id = parseInt(res.Id as string);
      if (!appInfo.packageFileName) {
        appInfo.packageFileName = this.getPackageNameFromFileName((res.File as { Name: string }).Name as string);
      }
      return;
    }

    if (args.options.appItemId) {
      if (!appInfo.packageFileName) {
        appInfo.packageFileName = this.getPackageNameFromFileName((res.File as { Name: string }).Name as string);
      }
      return;
    }

    appInfo.id = parseInt(res.Id as string);
  }

  private getPackageNameFromFileName(fileName: string): string {
    return `${path.basename(fileName, path.extname(fileName))}.zip`;
  }

  private async loadAppCatalogUrl(logger: Logger, args: CommandArgs): Promise<void> {
    if (this.appCatalogUrl) {
      return;
    }

    const spoUrl = await spo.getSpoUrl(logger, this.debug);
    const appCatalogUrl = await this.getAppCatalogSiteUrl(logger, spoUrl, args);
    this.appCatalogUrl = appCatalogUrl;
  }
}

export default new SpoAppTeamsPackageDownloadCommand();