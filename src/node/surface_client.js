/*
 *
 * Copyright 2014, Google Inc.
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 *     * Redistributions of source code must retain the above copyright
 * notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above
 * copyright notice, this list of conditions and the following disclaimer
 * in the documentation and/or other materials provided with the
 * distribution.
 *     * Neither the name of Google Inc. nor the names of its
 * contributors may be used to endorse or promote products derived from
 * this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 *
 */

var _ = require('underscore');

var client = require('./client.js');

var EventEmitter = require('events').EventEmitter;

var stream = require('stream');

var Readable = stream.Readable;
var Writable = stream.Writable;
var Duplex = stream.Duplex;
var util = require('util');

function forwardEvent(fromEmitter, toEmitter, event) {
  fromEmitter.on(event, function forward() {
    _.partial(toEmitter.emit, event).apply(toEmitter, arguments);
  });
}

util.inherits(ClientReadableObjectStream, Readable);

/**
 * Class for representing a gRPC server streaming call as a Node stream on the
 * client side. Extends from stream.Readable.
 * @constructor
 * @param {stream} stream Underlying binary Duplex stream for the call
 * @param {function(Buffer)} deserialize Function for deserializing binary data
 * @param {object} options Stream options
 */
function ClientReadableObjectStream(stream, deserialize, options) {
  options = _.extend(options, {objectMode: true});
  Readable.call(this, options);
  this._stream = stream;
  var self = this;
  forwardEvent(stream, this, 'status');
  forwardEvent(stream, this, 'metadata');
  this._stream.on('data', function forwardData(chunk) {
    if (!self.push(deserialize(chunk))) {
      self._stream.pause();
    }
  });
  this._stream.pause();
}

util.inherits(ClientWritableObjectStream, Writable);

/**
 * Class for representing a gRPC client streaming call as a Node stream on the
 * client side. Extends from stream.Writable.
 * @constructor
 * @param {stream} stream Underlying binary Duplex stream for the call
 * @param {function(*):Buffer} serialize Function for serializing objects
 * @param {object} options Stream options
 */
function ClientWritableObjectStream(stream, serialize, options) {
  options = _.extend(options, {objectMode: true});
  Writable.call(this, options);
  this._stream = stream;
  this._serialize = serialize;
  forwardEvent(stream, this, 'status');
  forwardEvent(stream, this, 'metadata');
  this.on('finish', function() {
    this._stream.end();
  });
}


util.inherits(ClientBidiObjectStream, Duplex);

/**
 * Class for representing a gRPC bidi streaming call as a Node stream on the
 * client side. Extends from stream.Duplex.
 * @constructor
 * @param {stream} stream Underlying binary Duplex stream for the call
 * @param {function(*):Buffer} serialize Function for serializing objects
 * @param {function(Buffer)} deserialize Function for deserializing binary data
 * @param {object} options Stream options
 */
function ClientBidiObjectStream(stream, serialize, deserialize, options) {
  options = _.extend(options, {objectMode: true});
  Duplex.call(this, options);
  this._stream = stream;
  this._serialize = serialize;
  var self = this;
  forwardEvent(stream, this, 'status');
  forwardEvent(stream, this, 'metadata');
  this._stream.on('data', function forwardData(chunk) {
    if (!self.push(deserialize(chunk))) {
      self._stream.pause();
    }
  });
  this._stream.pause();
  this.on('finish', function() {
    this._stream.end();
  });
}

/**
 * _read implementation for both types of streams that allow reading.
 * @this {ClientReadableObjectStream|ClientBidiObjectStream}
 * @param {number} size Ignored
 */
function _read(size) {
  this._stream.resume();
}

/**
 * See docs for _read
 */
ClientReadableObjectStream.prototype._read = _read;
/**
 * See docs for _read
 */
ClientBidiObjectStream.prototype._read = _read;

/**
 * _write implementation for both types of streams that allow writing
 * @this {ClientWritableObjectStream|ClientBidiObjectStream}
 * @param {*} chunk The value to write to the stream
 * @param {string} encoding Ignored
 * @param {function(Error)} callback Callback to call when finished writing
 */
function _write(chunk, encoding, callback) {
  this._stream.write(this._serialize(chunk), encoding, callback);
}

/**
 * See docs for _write
 */
ClientWritableObjectStream.prototype._write = _write;
/**
 * See docs for _write
 */
ClientBidiObjectStream.prototype._write = _write;

/**
 * Get a function that can make unary requests to the specified method.
 * @param {string} method The name of the method to request
 * @param {function(*):Buffer} serialize The serialization function for inputs
 * @param {function(Buffer)} deserialize The deserialization function for
 *     outputs
 * @return {Function} makeUnaryRequest
 */
function makeUnaryRequestFunction(method, serialize, deserialize) {
  /**
   * Make a unary request with this method on the given channel with the given
   * argument, callback, etc.
   * @param {client.Channel} channel The channel on which to make the request
   * @param {*} argument The argument to the call. Should be serializable with
   *     serialize
   * @param {function(?Error, value=)} callback The callback to for when the
   *     response is received
   * @param {array=} metadata Array of metadata key/value pairs to add to the
   *     call
   * @param {(number|Date)=} deadline The deadline for processing this request.
   *     Defaults to infinite future
   * @return {EventEmitter} An event emitter for stream related events
   */
  function makeUnaryRequest(channel, argument, callback, metadata, deadline) {
    var stream = client.makeRequest(channel, method, metadata, deadline);
    var emitter = new EventEmitter();
    forwardEvent(stream, emitter, 'status');
    forwardEvent(stream, emitter, 'metadata');
    stream.write(serialize(argument));
    stream.end();
    stream.on('data', function forwardData(chunk) {
      try {
        callback(null, deserialize(chunk));
      } catch (e) {
        callback(e);
      }
    });
    return emitter;
  }
  return makeUnaryRequest;
}

/**
 * Get a function that can make client stream requests to the specified method.
 * @param {string} method The name of the method to request
 * @param {function(*):Buffer} serialize The serialization function for inputs
 * @param {function(Buffer)} deserialize The deserialization function for
 *     outputs
 * @return {Function} makeClientStreamRequest
 */
function makeClientStreamRequestFunction(method, serialize, deserialize) {
  /**
   * Make a client stream request with this method on the given channel with the
   * given callback, etc.
   * @param {client.Channel} channel The channel on which to make the request
   * @param {function(?Error, value=)} callback The callback to for when the
   *     response is received
   * @param {array=} metadata Array of metadata key/value pairs to add to the
   *     call
   * @param {(number|Date)=} deadline The deadline for processing this request.
   *     Defaults to infinite future
   * @return {EventEmitter} An event emitter for stream related events
   */
  function makeClientStreamRequest(channel, callback, metadata, deadline) {
    var stream = client.makeRequest(channel, method, metadata, deadline);
    var obj_stream = new ClientWritableObjectStream(stream, serialize, {});
    stream.on('data', function forwardData(chunk) {
      try {
        callback(null, deserialize(chunk));
      } catch (e) {
        callback(e);
      }
    });
    return obj_stream;
  }
  return makeClientStreamRequest;
}

/**
 * Get a function that can make server stream requests to the specified method.
 * @param {string} method The name of the method to request
 * @param {function(*):Buffer} serialize The serialization function for inputs
 * @param {function(Buffer)} deserialize The deserialization function for
 *     outputs
 * @return {Function} makeServerStreamRequest
 */
function makeServerStreamRequestFunction(method, serialize, deserialize) {
  /**
   * Make a server stream request with this method on the given channel with the
   * given argument, etc.
   * @param {client.Channel} channel The channel on which to make the request
   * @param {*} argument The argument to the call. Should be serializable with
   *     serialize
   * @param {array=} metadata Array of metadata key/value pairs to add to the
   *     call
   * @param {(number|Date)=} deadline The deadline for processing this request.
   *     Defaults to infinite future
   * @return {EventEmitter} An event emitter for stream related events
   */
  function makeServerStreamRequest(channel, argument, metadata, deadline) {
    var stream = client.makeRequest(channel, method, metadata, deadline);
    var obj_stream = new ClientReadableObjectStream(stream, deserialize, {});
    stream.write(serialize(argument));
    stream.end();
    return obj_stream;
  }
  return makeServerStreamRequest;
}

/**
 * Get a function that can make bidirectional stream requests to the specified
 * method.
 * @param {string} method The name of the method to request
 * @param {function(*):Buffer} serialize The serialization function for inputs
 * @param {function(Buffer)} deserialize The deserialization function for
 *     outputs
 * @return {Function} makeBidiStreamRequest
 */
function makeBidiStreamRequestFunction(method, serialize, deserialize) {
  /**
   * Make a bidirectional stream request with this method on the given channel.
   * @param {client.Channel} channel The channel on which to make the request
   * @param {array=} metadata Array of metadata key/value pairs to add to the
   *     call
   * @param {(number|Date)=} deadline The deadline for processing this request.
   *     Defaults to infinite future
   * @return {EventEmitter} An event emitter for stream related events
   */
  function makeBidiStreamRequest(channel, metadata, deadline) {
    var stream = client.makeRequest(channel, method, metadata, deadline);
    var obj_stream = new ClientBidiObjectStream(stream,
                                                serialize,
                                                deserialize,
                                                {});
    return obj_stream;
  }
  return makeBidiStreamRequest;
}

/**
 * See docs for makeUnaryRequestFunction
 */
exports.makeUnaryRequestFunction = makeUnaryRequestFunction;

/**
 * See docs for makeClientStreamRequestFunction
 */
exports.makeClientStreamRequestFunction = makeClientStreamRequestFunction;

/**
 * See docs for makeServerStreamRequestFunction
 */
exports.makeServerStreamRequestFunction = makeServerStreamRequestFunction;

/**
 * See docs for makeBidiStreamRequestFunction
 */
exports.makeBidiStreamRequestFunction = makeBidiStreamRequestFunction;

/**
 * See docs for client.Channel
 */
exports.Channel = client.Channel;
/**
 * See docs for client.status
 */
exports.status = client.status;
/**
 * See docs for client.callError
 */
exports.callError = client.callError;