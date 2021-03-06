/*
 * grunt-locales Grunt task
 * https://github.com/blueimp/grunt-locales
 *
 * Copyright 2013, Sebastian Tschan
 * https://blueimp.net
 *
 * Licensed under the MIT license:
 * http://www.opensource.org/licenses/MIT
 */

/*jslint regexp: true, unparam: true, nomen: true */
/*global module, require, global, __dirname */

module.exports = function (grunt) {
    'use strict';

    function LocalesTask(task) {
        this.options = task.options({
            locales: ['en_US'],
            localizeAttributes: [
                'localize'
            ],
            localizeMethodIdentifiers: [
                'localize'
            ],
            htmlFileRegExp: /\.html$/,
            jsFileRegExp: /\.js$/,
            // Matches the locale name in a file path,
            // e.g. "en_US" in js/locale/en_US/i18n.json:
            localeRegExp: /\w+(?=\/[^\/]+$)/,
            localePlaceholder: '{locale}',
            localeName: 'i18n',
            localeJsonFlatFormat: false,
            // Set to true to wrap static translation strings with a function:
            wrapStaticTranslations: false,
            // Purge obsolete locale messages by default:
            purgeLocales: true,
            messageFormatLocaleFile:
                __dirname + '/../node_modules/messageformat/locale/{locale}.js',
            messageFormatSharedFile:
                __dirname + '/../node_modules/messageformat/lib/messageformat.include.js',
            localeTemplate: __dirname + '/../i18n.js.tmpl',
            // Allow ftp, http(s), mailto, anchors
            // and messageformat variables (href="{url}"):
            urlRegExp: /^((ftp|https?):\/\/|mailto:|#|\{\w+\})/,
            htmlmin: {
                removeComments: true,
                collapseWhitespace: true
            },
            htmlminKeys: false,
            jsonSpace: 2,
            csvEncapsulator: '"',
            csvDelimiter: ',',
            csvLineEnd: '\r\n',
            csvEscape: function (str) {
                return str.replace(/"/g, '""');
            },
            csvKeyLabel: 'ID',
            csvExtraFields: ['files']
        });
        if (!this.options.locales.length) {
            return grunt.fail.warn('No locales defined');
        }
        this.task = task;
        this.done = task.async();
        this[task.target]();
    }

    grunt.registerMultiTask(
        'locales',
        'Update, build, import and export locales.',
        function () {
            return new LocalesTask(this);
        }
    );

    function extend(dst) {
        grunt.util.toArray(arguments).forEach(function (obj) {
            var key;
            if (obj && obj !== dst) {
                for (key in obj) {
                    if (obj.hasOwnProperty(key)) {
                        dst[key] = obj[key];
                    }
                }
            }
        });
        return dst;
    }

    extend(LocalesTask.prototype, {
        extend: extend,

        jsEscape: function (str) {
            // Escape string for output in a quoted JS context,
            // e.g. var data = "OUTPUT";
            return str.replace(/\W/g, function (match) {
                var charCode = match.charCodeAt(0),
                    hexStr;
                // Escape non-printable characters, single and double quotes,
                // and the backslash.
                // Also escape HTML special characters (<>&) as the string
                // could be used in a JS context inside of a HTML context,
                // because a script closing tag (</script>) ends a script
                // block even inside of a quoted JS string, as the HTML parser
                // runs before the JS parser.
                if (charCode < 32 || '"\'\\<>&'.indexOf(match) !== -1) {
                    hexStr = charCode.toString(16);
                    if (hexStr.length < 2) {
                        hexStr = '0' + hexStr;
                    }
                    return '\\x' + hexStr;
                }
                return match;
            });
        },

        quote: function (str) {
            return '"' + str + '"';
        },

        sanitize: function (key, content, escapeKey) {
            // Throws exception for invalid HTML if htmlmin option is set
            var urlRegExp = this.options.urlRegExp,
                htmlmin = this.options.htmlmin,
                htmlminKeys = this.options.htmlminKeys && htmlmin,
                minify = htmlmin && require('html-minifier').minify,
                sanitizer = require('sanitizer'),
                sanitizeUrlCallback = function (value) {
                    if (urlRegExp.test(value)) {
                        return value;
                    }
                };
            key = String(key);
            key = (htmlminKeys && minify(key, htmlminKeys)) || key;
            if (escapeKey) {
                key = this.jsEscape(key);
            }
            content = String(content);
            content = sanitizer.sanitize(
                (htmlmin && minify(content, htmlmin)) || content,
                sanitizeUrlCallback
            );
            return {
                key: key,
                content: content
            };
        },

        getTextContent: function (str) {
            return require('cheerio')
                .load('<p>' + str + '</p>')('p')
                .text();
        },

        getAttributesSelector: function () {
            if (!this.attributesSelector) {
                var attrs = this.options.localizeAttributes,
                    items = [];
                attrs.forEach(function (attr) {
                    items.push('[' + attr + ']');
                    items.push('[data-' + attr + ']');
                });
                this.attributesSelector = items.join(',');
            }
            return this.attributesSelector;
        },

        extendMessages: function (messages, key, obj, update) {
            var originalMessage = messages[key];
            // grunt-locales v.4 and lower used a flat format
            // with strings instead of objects as message values:
            if (grunt.util.kindOf(obj) === 'string') {
                obj = {
                    value: obj
                };
            }
            if (!obj.files) {
                obj.files = [];
            }
            if (originalMessage) {
                // grunt-locales v.4 and lower used a flat format
                // with strings instead of objects as message values:
                if (grunt.util.kindOf(originalMessage) === 'string') {
                    originalMessage = {
                        value: originalMessage
                    };
                    messages[key] = originalMessage;
                }
                if (originalMessage.files && originalMessage.files.length) {
                    obj.files.forEach(function (file) {
                        if (originalMessage.files.indexOf(file) === -1) {
                            originalMessage.files.push(file);
                        }
                    });
                } else {
                    originalMessage.files = obj.files;
                }
                if (update) {
                    originalMessage.value = obj.value;
                }
            } else {
                if (update) {
                    return messages;
                }
                messages[key] = obj;
            }
            messages[key].files.sort();

            /*
             * to support generate Json file with flat format as
             * { "tranlsation_key": "translation_value" }
             */
            if (this.options.localeJsonFlatFormat){
                messages[key] = messages[key].value;
            }

            return messages;
        },

        decodeEntities: function (str) {
            // Decode the entities of the attribute value by making
            // use of cheerios default string loading behavior:
            // https://github.com/cheeriojs/cheerio#loading
            return require('cheerio')
                .load('<p title="' + str + '">')('p')
                .attr('title');
        },

        parseHTMLFile: function (file, str, messages, callback) {
            var that = this,
                attrs = this.options.localizeAttributes,
                defaultAttr = attrs[0],
                defaultAttrSelector = '[' + defaultAttr + '],[data-' + defaultAttr + ']',
                cheerio = require('cheerio'),
                // Don't decode entities, as this has the side effect
                // of turning all non-ascii characters into entities:
                $ = cheerio.load(str, {decodeEntities: false});
            $(this.getAttributesSelector()).each(function (index, element) {
                attrs.forEach(function (attr) {
                    var $element = $(element),
                        value = $element.attr(attr) || $element.data(attr),
                        $decode,
                        key,
                        sanitizedData;
                    if (value) {
                        // Decode the entities of the attribute value
                        // (cheerio default behavior):
                        value = that.decodeEntities(value);
                        key = value;
                    } else if (attr === defaultAttr && $element.is(defaultAttrSelector)) {
                        // Retrieve the element content:
                        value = $element.html();
                        try {
                            sanitizedData = that.sanitize(value, value);
                            value = sanitizedData.content;
                            key = sanitizedData.key;
                        } catch (e) {
                            return that.logError(e, value, null, file);
                        }
                    }
                    if (value) {
                        that.extendMessages(messages, key, {
                            value: value,
                            files: [file]
                        });
                    }
                });
            });
            callback.call(that);
        },

        parseJSFile: function (file, str, messages, callback) {
            var that = this,
                identifiers = this.options.localizeMethodIdentifiers,
                result,
                tokens;
            try {
                result = require('esprima').parse(str, {tokens: true, loc: true});
                tokens = result.tokens;
                tokens.forEach(function (token, index) {
                    var token2 = tokens[index + 1],
                        token3 = tokens[index + 2],
                        token4 = tokens[index + 3],
                        key;
                    if (token4 &&
                            token.type === 'Identifier' &&
                            identifiers.indexOf(token.value) !== -1 &&
                            token2.type === 'Punctuator' &&
                            token2.value === '(') {
                        if (token3.type === 'String' &&
                                token4.type === 'Punctuator' &&
                                (token4.value === ')' || token4.value === ',')) {
                            // The token3 value is a String expression, e.g. "'Hello {name}!'",
                            // which we have to evaluate to an actual String:
                            key = require('vm').runInThisContext(token3.value);
                            that.extendMessages(messages, key, {
                                value: key,
                                files: [file]
                            });
                        } else {
                            // The localize method has been called with a non-string argument:
                            grunt.log.warn(
                                'Unable to parse locale string from ' +
                                    file +
                                    ':' +
                                    token3.loc.start.line +
                                    ':' +
                                    token3.loc.start.column +
                                    '.'
                            );
                        }
                    }
                });
            } catch (err) {
                grunt.log.error(err);
            }
            callback.call(this);
        },

        parseSourceFile: function (file, messages, callback) {
            var that = this;
            require('fs').readFile(file, function (err, str) {
                if (err) {
                    grunt.log.error(err);
                    return callback.call(that);
                }
                if (that.options.htmlFileRegExp.test(file)) {
                    that.parseHTMLFile(file, str, messages, callback);
                } else if (that.options.jsFileRegExp.test(file)) {
                    that.parseJSFile(file, str, messages, callback);
                } else {
                    grunt.log.warn('Source file ' + file.cyan + ' not matched as HTML or JS file.');
                    callback.call(that);
                }
            });
        },

        getSourceFiles: function () {
            var files = this.task.filesSrc;
            if (this.task.args.length) {
                files = this.task.args;
            }
            return files.filter(function (file) {
                if (!grunt.file.exists(file)) {
                    grunt.log.warn('Source file ' + file.cyan + ' not found.');
                    return false;
                }
                return true;
            });
        },

        getDestinationFilePath: function () {
            var dest = this.task.files.length && this.task.files[0].dest;
            if (!dest) {
                grunt.fail.warn('Missing destination file path.');
                return this.done();
            }
            return dest;
        },

        getLocaleFromPath: function (path) {
            var regexp = this.options.localeRegExp,
                localeMatch = regexp.exec(path),
                locale = localeMatch && localeMatch[0];
            if (!locale) {
                grunt.fail.warn(
                    'Regular expression ' + regexp.toString().cyan +
                        ' failed to match locale in path ' +
                        path.cyan + '.'
                );
                return this.done();
            }
            return locale;
        },

        getLocaleTemplate: function () {
            var file = this.options.localeTemplate;
            if (!grunt.file.exists(file)) {
                grunt.fail.warn('Locale template ' + file.cyan + ' not found.');
                return this.done();
            }
            return grunt.file.read(file);
        },

        needsTranslationFunction: function (key, value) {
            return (this.options.wrapStaticTranslations && key !== value) ||
                /\{/.test(value);
        },

        getMessageFormatLocale: function (locale) {
            var file = this.options.messageFormatLocaleFile.replace(
                this.options.localePlaceholder,
                locale.slice(0, 2)
            );
            if (!grunt.file.exists(file)) {
                grunt.fail.warn('MessageFormat locale file ' + file.cyan + ' not found.');
                return this.done();
            }
            return grunt.file.read(file);
        },

        getMessageFormatShared: function () {
            var file = this.options.messageFormatSharedFile;
            if (!grunt.file.exists(file)) {
                grunt.fail.warn('MessageFormat shared file ' + file.cyan + ' not found.');
                return this.done();
            }
            return grunt.file.read(file);
        },

        messageFormatFactory: function (locale, messageFormatLocale) {
            if (!global.MessageFormat) {
                global.MessageFormat = require('messageformat');
            }
            require('vm').createScript(
                messageFormatLocale || this.getMessageFormatLocale(locale)
            ).runInThisContext();
            return new global.MessageFormat(locale.slice(0, 2));
        },

        logError: function (e, key, locale, file) {
            grunt.log.warn(
                e.name + ':\n',
                'Error:  ' + e.message + '\n',
                'Column: ' + e.column + '\n',
                'Line:   ' + e.line + '\n',
                'Key:    ' + key.replace('\n', '\\n') + '\n',
                'Locale: ' + locale + '\n',
                'File: ' + file
            );
        },

        parse: function (callback) {
            var that = this,
                counter = 0,
                messages = {},
                defaultMessagesSource = that.options.defaultMessagesSource || '[]';
            grunt.file.expand(defaultMessagesSource).forEach(function (file) {
                var defaultMessages = grunt.file.readJSON(file),
                    key;
                for (key in defaultMessages) {
                    if (defaultMessages.hasOwnProperty(key)) {
                        that.extendMessages(messages, key, defaultMessages[key]);
                    }
                }
                grunt.log.writeln('Parsed locales from ' + file.cyan + '.');
            });
            this.getSourceFiles().forEach(function (file) {
                counter += 1;
                that.parseSourceFile(file, messages, function () {
                    grunt.log.writeln('Parsed locales from ' + file.cyan + '.');
                    counter -= 1;
                    if (!counter) {
                        callback.call(that, messages);
                    }
                });
            });
            if (!counter) {
                callback.call(that, messages);
            }
        },

        update: function () {
            var that = this,
                dest = this.getDestinationFilePath(),
                // Don't purge locales if only a subset of files is parsed:
                purgeLocales = this.options.purgeLocales && !this.task.args.length;
            this.parse(function (parsedMessages) {
                that.options.locales.forEach(function (locale) {
                    var localeFile = dest.replace(that.options.localePlaceholder, locale),
                        localeFileExists = grunt.file.exists(localeFile),
                        sortedMessages = {},
                        messages,
                        key;
                    if (localeFileExists) {
                        messages = grunt.file.readJSON(localeFile);
                        grunt.log.writeln('Parsed locales from ' + localeFile.cyan + '.');
                        // Extend the existing messages with the parsed set:
                        for (key in parsedMessages) {
                            if (parsedMessages.hasOwnProperty(key)) {
                                that.extendMessages(messages, key, parsedMessages[key]);
                            }
                        }
                    } else {
                        messages = parsedMessages;
                    }
                    // JavaScript objects are not ordered, however, creating a new object
                    // based on sorted keys creates a more consistent JSON output:
                    Object.keys(purgeLocales ? parsedMessages : messages).sort()
                        .forEach(function (key) {
                            sortedMessages[key] = messages[key];
                        });
                    grunt.file.write(
                        localeFile,
                        JSON.stringify(
                            sortedMessages,
                            that.options.jsonReplacer,
                            that.options.jsonSpace
                        ) + '\n'
                    );
                    grunt.log.writeln(
                        (localeFileExists ? 'Updated' : 'Created') +
                            ' locale file ' + localeFile.cyan + '.'
                    );
                });
                that.done();
            });
        },

        build: function () {
            var that = this,
                dest = this.getDestinationFilePath();
            this.getSourceFiles().forEach(function (file) {
                var locale = that.getLocaleFromPath(file),
                    destFile = dest.replace(that.options.localePlaceholder, locale),
                    messages = grunt.file.readJSON(file),
                    messageFormatLocale = that.getMessageFormatLocale(locale),
                    messageFormatShared = that.getMessageFormatShared(),
                    translationsMap = {},
                    messageFormat = that.messageFormatFactory(locale, messageFormatLocale);
                Object.keys(messages).sort().forEach(function (key) {
                    try {
                        var value = messages[key].value,
                            sanitizedData = that.sanitize(key, value, true),
                            quotedKey = that.quote(sanitizedData.key),
                            content = sanitizedData.content,
                            textContent = that.getTextContent(content);
                        // Keep the original value, if the textContent is the same:
                        if (value === textContent) {
                            content = textContent;
                        }
                        if (that.needsTranslationFunction(key, content)) {
                            translationsMap[quotedKey] = messageFormat.precompile(
                                messageFormat.parse(content)
                            );
                        } else if (key !== value) {
                            translationsMap[quotedKey] = that.quote(that.jsEscape(content));
                        }
                    } catch (e) {
                        return that.logError(e, key, locale, file);
                    }
                });
                grunt.log.writeln('Parsed locales from ' + file.cyan + '.');
                grunt.file.write(destFile, grunt.template.process(
                    that.getLocaleTemplate(),
                    {
                        data: {
                            locale: locale,
                            localeName: that.options.localeName,
                            messageFormatLocale: messageFormatLocale,
                            messageFormatShared: messageFormatShared,
                            translationsMap: translationsMap
                        }
                    }
                ));
                grunt.log.writeln('Updated locale file ' + destFile.cyan + '.');
            });
            this.done();
        },

        'export': function () {
            var that = this,
                dest = this.getDestinationFilePath(),
                options = this.options,
                encapsulator = options.csvEncapsulator,
                delimiter = options.csvDelimiter,
                lineEnd = options.csvLineEnd,
                escapeFunc = options.csvEscape,
                extraFields = options.csvExtraFields || [];
            this.getSourceFiles().forEach(function (file) {
                var locale = that.getLocaleFromPath(file),
                    localesMap = grunt.file.readJSON(file),
                    destFile = dest.replace(that.options.localePlaceholder, locale),
                    str;
                grunt.log.writeln('Parsed locales from ' + file.cyan + '.');
                str = encapsulator + escapeFunc(that.options.csvKeyLabel) + encapsulator +
                    delimiter +
                    encapsulator + escapeFunc(locale) + encapsulator;
                extraFields.forEach(function (field) {
                    str += delimiter +
                        encapsulator + escapeFunc(field) + encapsulator;
                });
                str += lineEnd;
                Object.keys(localesMap).sort().forEach(function (key) {
                    var message = localesMap[key],
                        messageValue = String(message.value || '');
                    str +=  encapsulator + escapeFunc(key) + encapsulator +
                        delimiter +
                        encapsulator + escapeFunc(messageValue) + encapsulator;
                    extraFields.forEach(function (field) {
                        var fieldValue = String(message[field] || '');
                        str += delimiter +
                            encapsulator + escapeFunc(fieldValue) + encapsulator;
                    });
                    str += lineEnd;
                });
                grunt.file.write(destFile, str);
                grunt.log.writeln('Exported locales to ' + destFile.cyan + '.');
            });
            this.done();
        },

        'import': function () {
            var that = this,
                locales = this.options.locales,
                localeFiles = {},
                messageFormatMap = {},
                keyLabel = this.options.csvKeyLabel,
                csv = require('csv'),
                files = this.getSourceFiles(),
                dest = this.getDestinationFilePath(),
                counter = 0;
            if (!files.length) {
                grunt.log.warn('No import source file found.');
                return this.done();
            }
            locales.forEach(function (locale) {
                localeFiles[locale] = dest.replace(
                    that.options.localePlaceholder,
                    locale
                );
                messageFormatMap[locale] = that.messageFormatFactory(locale);
            });
            files.forEach(function (file) {
                counter += 1;
                var messagesMap = {};
                csv().from.path(file, {columns: true})
                    .transform(function (row) {
                        var key = row[keyLabel];
                        locales.forEach(function (locale) {
                            var value = row[locale],
                                content,
                                textContent;
                            if (!value) {
                                return;
                            }
                            try {
                                content = that.sanitize(key, value).content;
                                if (!content) {
                                    return;
                                }
                                textContent = that.getTextContent(content);
                                // Keep the original value, if the textContent is the same:
                                if (value === textContent) {
                                    content = textContent;
                                }
                                messageFormatMap[locale].parse(content);
                                if (!messagesMap[locale]) {
                                    messagesMap[locale] = {};
                                }
                                messagesMap[locale][key] = {
                                    value: content
                                };
                            } catch (e) {
                                return that.logError(e, key, locale, file);
                            }
                        });
                    })
                    .on('end', function () {
                        grunt.log.writeln('Parsed locales from ' + file.cyan + '.');
                        Object.keys(messagesMap).forEach(function (locale) {
                            var localeFile = localeFiles[locale],
                                importedMessages = messagesMap[locale],
                                messages,
                                key;
                            if (!grunt.file.exists(localeFile)) {
                                grunt.log.warn('Import target file ' + localeFile.cyan + ' not found.');
                                return;
                            }
                            messages = grunt.file.readJSON(localeFile);
                            for (key in importedMessages) {
                                if (importedMessages.hasOwnProperty(key)) {
                                    that.extendMessages(messages, key, importedMessages[key], true);
                                }
                            }
                            grunt.file.write(
                                localeFile,
                                JSON.stringify(
                                    messages,
                                    that.options.jsonReplacer,
                                    that.options.jsonSpace
                                ) + '\n'
                            );
                            grunt.log.writeln('Updated locale file ' + localeFile.cyan + '.');
                        });
                        counter -= 1;
                        if (!counter) {
                            that.done();
                        }
                    });
            });
        }

    });

};
