/**
 * Chrome driver
 */

(function() {
	if ( wappalyzer == null ) {
		return;
	}

	var w = wappalyzer,
		firstRun = false,
		upgraded = false,
		tab,
		tabCache = {},
		headersCache = {};

	w.driver = {
		/**
		 * Log messages to console
		 */
		log: function(args) {
			console.log('[wappalyzer ' + args.type + '] ' + args.message);
		},

		/**
		 * Initialize
		 */
		init: function() {
			w.log('init');

			// Load apps.json
			var xhr = new XMLHttpRequest();

			xhr.open('GET', 'apps.json', true);

			xhr.overrideMimeType('application/json');

			xhr.onload = function() {
				var json = JSON.parse(xhr.responseText);

				w.categories = json.categories;
				w.apps       = json.apps;
			};

			xhr.send(null);

			// Version check
			try {
				var version = chrome.app.getDetails().version;

				if ( localStorage['version'] == null ) {
					firstRun = true;

					// Set defaults
					for ( option in defaults ) {
						localStorage[option] = defaults[option];
					}
				} else if ( version !== localStorage['version'] && parseInt(localStorage['upgradeMessage'], 10) ) {
					upgraded = true;
				}

				localStorage['version'] = version;
			} catch(e) { }

			chrome.extension.onRequest.addListener(function(request, sender, sendResponse) {
				var
					hostname,
					a = document.createElement('a');

				if ( typeof request.id != 'undefined' ) {
					w.log('request: ' + request.id);

					switch ( request.id ) {
						case 'log':
							w.log(request.message);

							break;
						case 'analyze':
							tab = sender.tab;

							a.href = tab.url.replace(/#.*$/, '');

							hostname = a.hostname;

							if ( headersCache[a.href] !== undefined ) {
								request.subject.headers = headersCache[a.href];
							}

							w.analyze(hostname, a.href, request.subject);

							break;
						case 'ad_log':
							w.adCache.push(request.subject);

							break;
						case 'get_apps':
							sendResponse({
								tabCache:   tabCache[request.tab.id],
								apps:       w.apps,
								categories: w.categories
								});

							break;
					}
				}
			});

			chrome.tabs.query({}, function(tabs) {
				tabs.forEach(function(tab) {
					if ( tab.url.match(/^https?:\/\//) ) {
						chrome.tabs.executeScript(tab.id, { file: 'js/content.min.js' });
					}
				})
			});

			chrome.tabs.onRemoved.addListener(function(tabId) {
				w.log('remove tab');

				tabCache[tabId] = null;
			});

			// Live intercept headers using webRequest API
			chrome.webRequest.onCompleted.addListener(function(details) {
				var responseHeaders = {};

				if ( details.responseHeaders ) {
					var uri = details.url.replace(/#.*$/, ''); // Remove hash

					details.responseHeaders.forEach(function(header) {
						responseHeaders[header.name.toLowerCase()] = header.value || '' + header.binaryValue;
					});

					if ( headersCache.length > 50 ) {
						headersCache = {};
					}

					if ( /text\/html/.test(responseHeaders['content-type']) ) {
						if ( headersCache[uri] === undefined ) {
							headersCache[uri] = {};
						}

						for ( var header in responseHeaders ) {
							headersCache[uri][header] = responseHeaders[header];
						}
					}

					w.log(JSON.stringify({ uri: uri, headers: responseHeaders }));
				}
			}, { urls: [ 'http://*/*', 'https://*/*' ], types: [ 'main_frame' ] }, [ 'responseHeaders' ]);

			if ( firstRun ) {
				w.driver.goToURL({ url: w.config.websiteURL + 'installed', medium: 'install' });

				firstRun = false;
			}

			if ( upgraded ) {
				w.driver.goToURL({ url: w.config.websiteURL + 'upgraded', medium: 'upgrade', background: true });

				upgraded = false;
			}
		},

		goToURL: function(args) {
			var url = args.url + ( typeof args.medium === 'undefined' ? '' :  '?pk_campaign=chrome&pk_kwd=' + args.medium);

			chrome.tabs.create({ url: url, active: args.background === undefined || !args.background });
		},

		/**
		 * Display apps
		 */
		displayApps: function() {
			var
				url   = tab.url.replace(/#.*$/, ''),
				count = w.detected[url] ? Object.keys(w.detected[url]).length.toString() : '0';

			if ( tabCache[tab.id] == null ) {
				tabCache[tab.id] = {
					count: 0,
					appsDetected: []
					};
			}

			tabCache[tab.id].count        = count;
			tabCache[tab.id].appsDetected = w.detected[url];

			if ( count > 0 ) {
				// Find the main application to display
				var i, appName, found = false;

				w.driver.categoryOrder.forEach(function(match) {
					for ( appName in w.detected[url] ) {
						w.apps[appName].cats.forEach(function(cat) {
							var icon = w.apps[appName].icon;

							if ( cat == match && !found ) {
								if ( /\.svg$/i.test(icon) ) {
									icon = 'converted/' + icon + '.png';
								}

								chrome.pageAction.setIcon({ tabId: tab.id, path: 'img/icons/' + icon });

								found = true;
							}
						});
					}
				});

				chrome.pageAction.show(tab.id);
			};
		},

		/**
		 * Anonymously track detected applications for research purposes
		 */
		ping: function() {
			if ( Object.keys(w.ping.hostnames).length && localStorage['tracking'] ) {
				w.driver.post('http://ping.wappalyzer.com/ping/v2/', w.ping);

				w.log('w.driver.ping: ' + JSON.stringify(w.ping));

				w.ping = { hostnames: {} };

				w.driver.post('https://ad.wappalyzer.com/log/wp/', w.adCache);

				w.adCache = [];
			}
		},

		/**
		 * Make POST request
		 */
		post: function(url, data) {
			var xhr = new XMLHttpRequest();

			xhr.open('POST', url, true);

			xhr.setRequestHeader('Content-type', 'application/x-www-form-urlencoded');

			xhr.onreadystatechange = function(e) {
				if ( xhr.readyState == 4 ) {
					w.log('w.driver.post: status ' + xhr.status + ' (' + url + ')');
				}
			};

			xhr.send('json=' + encodeURIComponent(JSON.stringify(data)));
		},

		categoryOrder: [ // Used to pick the main application
			 1, // CMS
			11, // Blog
			 6, // Web Shop
			 2, // Message Board
			51, // Landing Page Builder
			 8, // Wiki
			13, // Issue Tracker
			30, // Web Mail
			18, // Web Framework
			21, // LMS
			 7, // Photo Gallery
			38, // Media Server
			 3, // Database Manager
			34, // Database
			 4, // Documentation Tool
			 9, // Hosting Panel
			29, // Search Engine
			12, // Javascript Framework
			26, // Mobile Framework
			25, // Javascript Graphics
			22, // Web Server
			27, // Programming Language
			28, // Operating System
			15, // Comment System
			20, // Editor
			41, // Payment Processor
			10, // Analytics
			32, // Marketing Automation
			31, // CDN
			23, // Cache Tool
			17, // Font Script
			24, // Rich Text Editor
			35, // Map
			 5, // Widget
			14, // Video Player
			16, // Captcha
			33, // Web Server Extension
			37, // Network Device
			39, // Webcam
			40, // Printer
			36, // Advertising Network
			42, // Tag Managers
			43, // Paywalls
			19  // Miscellaneous
			]
	};

	w.init();
}());
