// @flow
import { join } from 'path'
import { logger as httpLogger, requestWhitelist, responseWhitelist } from '@chrisalderson/express-winston'
import type { Middleware } from 'express'
import { type createLogger as Winston, loggers, format, transports } from 'winston'

/**
 * Class for setting up the logger.
 * @type {Logger}
 */
export default class Logger {

  /**
   * The log levels the logger middleware will be using.
   * @type {Object}
   */
  levels: Object

  /**
   * The name of the log file.
   * @type {string}
   */
  name: string

  /**
   * The directory where the log file will be stored.
   * @type {string}
   */
  logDir: string

  /**
   * Create a new Logger object.
   * @param {!PopApi} PopApi - The PopApi instance to bind the logger to.
   * @param {!Object} options - The options for the logger.
   * @param {!string} options.name - The name of the log file.
   * @param {?boolean} [options.pretty] - Pretty mode for output with colors.
   * @throws {TypeError} - 'name' and 'logDir' are required options for the
   * Logger middleware!
   */
  constructor(PopApi: any, { name, logDir, pretty }: Object): void {
    const { name: debugName } = this.constructor
    PopApi.debug(`Registering ${debugName} middleware with options: %o`, {
      name,
      logDir,
      pretty,
    })

    if (!name || !logDir) {
      throw new TypeError('\'name\' and \'logDir\' are required options for the Logger middleware!')
    }

    /**
     * The log levels the logger middleware will be using.
     * @type {Object}
     */
    this.levels = {
      error: 0,
      warn: 1,
      info: 2,
      debug: 3,
    }
    /**
     * The name of the log file.
     * @type {string}
     */
    this.name = name
    /**
     * The directory where the log file will be stored.
     * @type {string}
     */
    this.logDir = logDir

    global.logger = this.getLogger('logger', pretty)
    PopApi.httpLogger = this.getLogger('http', pretty)
  }

  /**
   * Get the color of the output based on the log level.
   * @param {?string} [level=info] - The log level.
   * @returns {string} - A color based on the log level.
   */
  getLevelColor(level: string = 'info'): string {
    const colors = {
      error: '\x1b[31m',
      warn: '\x1b[33m',
      info: '\x1b[36m',
      debug: '\x1b[34m',
    }

    return colors[level]
  }

  /**
   * Formatter to update the message property and add the splat property to the
   * info object for interpolation.
   * @returns {Function} - Format function to enrich the info object with the
   * modified message and splat property.
   */
  prettyPrint(): Function {
    const enrichFmt = format((info: Object): Object => {
      const { level, message, ms, timestamp } = info
      const c = this.getLevelColor(level)

      info.splat = [
        timestamp,
        level.toUpperCase().padStart(5),
        this.name.padStart(2),
        message,
        ms,
      ]

      info.message = `\x1b[0m[%s] ${c}%s:\x1b[0m %s: \x1b[36m%s\x1b[0m \x1b[37m%s`

      return info
    })

    return enrichFmt()
  }

  /**
   * Formatter to get the message string from the info object.
   * @returns {Function} - Format function to get the message string to print
   * out of the info object.
   */
  _getMessage(): Function {
    return format.printf((info: Object): string => {
      return info.message
    })
  }

  /**
   * Formatter method which formats the output to the console.
   * @returns {Object} - The formatter for the console transport.
   */
  getFormatter(): Object {
    return format.combine(
      format.timestamp(),
      format.ms(),
      this.prettyPrint(),
      format.splat(),
      this._getMessage(),
    )
  }

  /**
   * Create a Console transport.
   * @param {?boolean} [pretty] - Pretty mode for output with colors.
   * @returns {Object} - A configured Console transport.
   */
  getConsoleTransport(pretty?: boolean): Object {
    const format = pretty
      ? this.getFormatter()
      : format.simple()

    return new transports.Console({
      name: this.name,
      format,
    })
  }

  /**
   * Create a File transport.
   * @param {!string} file - The file to log the output to.
   * @returns {Object} - A configured File transport.
   */
  getFileTransport(file: string): Object {
    return new transports.File({
      level: 'warn',
      filename: join(...[
        this.logDir,
        `${file}.log`,
      ]),
      format: this.getFormatter(),
      maxsize: 5242880,
      handleExceptions: true,
    })
  }

  /**
   * Create a logger instance.
   * @param {!string} suffix - The suffix for the log file.
   * @param {?boolean} [pretty] - Pretty mode for output with colors.
   * @returns {Winston} - A configured logger instance.
   */
  createLoggerInstance(suffix: string, pretty?: boolean): Winston {
    const id = `${this.name}-${suffix}`

    return loggers.add(id, {
      silent: process.env.NODE_ENV === 'test',
      levels: this.levels,
      level: 'debug',
      exitOnError: false,
      transports: [
        this.getConsoleTransport(pretty),
        this.getFileTransport(id),
      ],
    })
  }

  /**
   * Get the log message for Http logger.
   * @param {!Object} req - The request object to log.
   * @param {!Object} res - The response object to log.
   * @returns {string} - The HtpP log message to print.
   */
  getHttpLoggerMessage(req: $Response, res: $Response): string {
    return `HTTP ${req.method} ${req.url} ${res.statusCode} ${res.responseTime}ms`
  }

  /**
   * Create a Http logger instance.
   * @param {?boolean} [pretty] - Pretty mode for output with colors.
   * @returns {ExpressWinston} - A configured Http logger instance.
   */
  createHttpLogger(pretty?: boolean): Middleware {
    const logger = this.createLoggerInstance('http', pretty)
    const options: {
      [key: string]: mixed
    } = {
      winstonInstance: logger,
      meta: true,
      msg: this.getHttpLoggerMessage,
      statusLevels: true,
    }

    if (process.env.NODE_ENV === 'development') {
      logger.add(new transports.Console({
        name: this.name,
        format: format.json({
          space: 2,
        }),
      }))

      options.requestWhitelist = [].concat(requestWhitelist, 'body')
      options.responseWhitelist = [].concat(responseWhitelist, 'body')
    }

    return httpLogger(options)
  }

  /**
   * Get a logger object based on the choice.
   * @param {?string} [type] - The choice for the logger object.
   * @param {?boolean} [pretty] - Pretty mode for output with colors.
   * @returns {Middleware|Winston|undefined} - The logger object.
   */
  getLogger(type?: string, pretty?: boolean): Middleware | Winston | void {
    if (!type) {
      return undefined
    }

    const t = type.toUpperCase()

    switch (t) {
      case 'HTTP':
        return this.createHttpLogger(pretty)

      case 'LOGGER':
        return this.createLoggerInstance('app', pretty)

      default:
        return undefined
    }
  }

}
