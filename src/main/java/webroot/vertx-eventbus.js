
!function (factory) {
  if (typeof require === 'function' && typeof module !== 'undefined') {
    var SockJS = require('sockjs-client');
    if(!SockJS) {
      throw new Error('vertx-eventbus.js requires sockjs-client, see http://sockjs.org');
    }
    factory(SockJS);
  } else if (typeof define === 'function' && define.amd) {
    define('vertx-eventbus', ['sockjs'], factory);
  } else {
    // plain old include
    if (typeof this.SockJS === 'undefined') {
      throw new Error('vertx-eventbus.js requires sockjs-client, see http://sockjs.org');
    }

    EventBus = factory(this.SockJS);
  }
}(function (SockJS) {

  function makeUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (a, b) {
      return b = Math.random() * 16, (a == 'y' ? b & 3 | 8 : b | 0).toString(16);
    });
  }

  function mergeHeaders(defaultHeaders, headers) {
    if (defaultHeaders) {
      if(!headers) {
        return defaultHeaders;
      }

      for (var headerName in defaultHeaders) {
        if (defaultHeaders.hasOwnProperty(headerName)) {
          // user can overwrite the default headers
          if (typeof headers[headerName] === 'undefined') {
            headers[headerName] = defaultHeaders[headerName];
          }
        }
      }
    }

    return headers || {};
  }


  var EventBus = function (url, options) {
    var self = this;

    options = options || {};

    var pingInterval = options.vertxbus_ping_interval || 5000;
    var pingTimerID;

    this.sockJSConn = new SockJS(url, null, options);
    this.state = EventBus.CONNECTING;
    this.handlers = {};
    this.replyHandlers = {};
    this.defaultHeaders = null;

    this.onerror = console.error;

    var sendPing = function () {
      self.sockJSConn.send(JSON.stringify({type: 'ping'}));
    };

    this.sockJSConn.onopen = function () {
      sendPing();
      pingTimerID = setInterval(sendPing, pingInterval);
      self.state = EventBus.OPEN;
      self.onopen && self.onopen();
    };

    this.sockJSConn.onclose = function () {
      self.state = EventBus.CLOSED;
      if (pingTimerID) clearInterval(pingTimerID);
      self.onclose && self.onclose();
    };

    this.sockJSConn.onmessage = function (e) {
      var json = JSON.parse(e.data);

      if (json.replyAddress) {
        Object.defineProperty(json, 'reply', {
          value: function (message, headers, callback) {
            self.send(json.replyAddress, message, headers, callback);
          }
        });
      }

      if (self.handlers[json.address]) {
        var handlers = self.handlers[json.address];
        for (var i = 0; i < handlers.length; i++) {
          if (json.type === 'err') {
            handlers[i]({failureCode: json.failureCode, failureType: json.failureType, message: json.message});
          } else {
            handlers[i](null, json);
          }
        }
      } else if (self.replyHandlers[json.address]) {
        var handler = self.replyHandlers[json.address];
        delete self.replyHandlers[json.address];
        if (json.type === 'err') {
          handler({failureCode: json.failureCode, failureType: json.failureType, message: json.message});
        } else {
          handler(null, json);
        }
      } else {
        if (json.type === 'err') {
          self.onerror(json);
        } else {
          console.warn('No handler found for message: ', json);
        }
      }
    }
  };


  EventBus.prototype.send = function (address, message, headers, callback) {
    // are we ready?
    if (this.state != EventBus.OPEN) {
      throw new Error('INVALID_STATE_ERR');
    }

    if (typeof headers === 'function') {
      callback = headers;
      headers = {};
    }

    var envelope = {
      type: 'send',
      address: address,
      headers: mergeHeaders(this.defaultHeaders, headers),
      body: message
    };

    if (callback) {
      var replyAddress = makeUUID();
      envelope.replyAddress = replyAddress;
      this.replyHandlers[replyAddress] = callback;
    }

    this.sockJSConn.send(JSON.stringify(envelope));
  };


  EventBus.prototype.publish = function (address, message, headers) {
    if (this.state != EventBus.OPEN) {
      throw new Error('INVALID_STATE_ERR');
    }

    this.sockJSConn.send(JSON.stringify({
      type: 'publish',
      address: address,
      headers: mergeHeaders(this.defaultHeaders, headers),
      body: message
    }));
  };


  EventBus.prototype.registerHandler = function (address, headers, callback) {
    if (this.state != EventBus.OPEN) {
      throw new Error('INVALID_STATE_ERR');
    }

    if (typeof headers === 'function') {
      callback = headers;
      headers = {};
    }

    if (!this.handlers[address]) {
      this.handlers[address] = [];
      this.sockJSConn.send(JSON.stringify({
        type: 'register',
        address: address,
        headers: mergeHeaders(this.defaultHeaders, headers)
      }));
    }

    this.handlers[address].push(callback);
  };


  EventBus.prototype.unregisterHandler = function (address, headers, callback) {
    if (this.state != EventBus.OPEN) {
      throw new Error('INVALID_STATE_ERR');
    }

    var handlers = this.handlers[address];

    if (handlers) {

      if (typeof headers === 'function') {
        callback = headers;
        headers = {};
      }

      var idx = handlers.indexOf(callback);
      if (idx != -1) {
        handlers.splice(idx, 1);
        if (handlers.length === 0) {
          this.sockJSConn.send(JSON.stringify({
            type: 'unregister',
            address: address,
            headers: mergeHeaders(this.defaultHeaders, headers)
          }));

          delete this.handlers[address];
        }
      }
    }
  };


  EventBus.prototype.close = function () {
    this.state = vertx.EventBus.CLOSING;
    this.sockJSConn.close();
  };

  EventBus.CONNECTING = 0;
  EventBus.OPEN = 1;
  EventBus.CLOSING = 2;
  EventBus.CLOSED = 3;

  if (typeof exports !== 'undefined') {
    if (typeof module !== 'undefined' && module.exports) {
      exports = module.exports = EventBus;
    } else {
      exports.EventBus = EventBus;
    }
  } else {
    return EventBus;
  }
});