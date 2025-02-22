/**
 * @license Copyright (c) 2003-2021, CKSource - Frederico Knabben. All rights reserved.
 * For licensing, see LICENSE.md or https://ckeditor.com/legal/ckeditor-oss-license
 */

/**
 * @module clipboard/clipboardpipeline
 */

import Plugin from '@ckeditor/ckeditor5-core/src/plugin';
import EventInfo from '@ckeditor/ckeditor5-utils/src/eventinfo';

import ClipboardObserver from './clipboardobserver';

import plainTextToHtml from './utils/plaintexttohtml';
import normalizeClipboardHtml from './utils/normalizeclipboarddata';
import viewToPlainText from './utils/viewtoplaintext.js';

// Input pipeline events overview:
//
//              ┌──────────────────────┐          ┌──────────────────────┐
//              │     view.Document    │          │     view.Document    │
//              │         paste        │          │         drop         │
//              └───────────┬──────────┘          └───────────┬──────────┘
//                          │                                 │
//                          └────────────────┌────────────────┘
//                                           │
//                                 ┌─────────V────────┐
//                                 │   view.Document  │   Retrieves text/html or text/plain from data.dataTransfer
//                                 │  clipboardInput  │   and processes it to view.DocumentFragment.
//                                 └─────────┬────────┘
//                                           │
//                               ┌───────────V───────────┐
//                               │   ClipboardPipeline   │   Converts view.DocumentFragment to model.DocumentFragment.
//                               │  inputTransformation  │
//                               └───────────┬───────────┘
//                                           │
//                                ┌──────────V──────────┐
//                                │  ClipboardPipeline  │   Calls model.insertContent().
//                                │   contentInsertion  │
//                                └─────────────────────┘
//
//
// Output pipeline events overview:
//
//              ┌──────────────────────┐          ┌──────────────────────┐
//              │     view.Document    │          │     view.Document    │   Retrieves the selected model.DocumentFragment
//              │         copy         │          │          cut         │   and converts it to view.DocumentFragment.
//              └───────────┬──────────┘          └───────────┬──────────┘
//                          │                                 │
//                          └────────────────┌────────────────┘
//                                           │
//                                 ┌─────────V────────┐
//                                 │   view.Document  │   Processes view.DocumentFragment to text/html and text/plain
//                                 │  clipboardOutput │   and stores results in data.dataTransfer.
//                                 └──────────────────┘
//

/**
 * The clipboard pipeline feature. It is responsible for intercepting the `paste` and `drop` events and
 * passing the pasted content through the series of events in order to insert it into the editor's content.
 * It also handles the `cut` and `copy` events to fill the native clipboard with serialized editor's data.
 *
 * Read more about the clipboard integration in {@glink framework/guides/deep-dive/clipboard "Clipboard" deep dive} guide.
 *
 * @extends module:core/plugin~Plugin
 */
export default class ClipboardPipeline extends Plugin {
	/**
	 * @inheritDoc
	 */
	static get pluginName() {
		return 'ClipboardPipeline';
	}

	/**
	 * @inheritDoc
	 */
	init() {
		const editor = this.editor;
		const view = editor.editing.view;

		view.addObserver( ClipboardObserver );

		this._setupPasteDrop();
		this._setupCopyCut();
	}

	/**
	 * The clipboard paste pipeline.
	 *
	 * @private
	 */
	_setupPasteDrop() {
		const editor = this.editor;
		const model = editor.model;
		const view = editor.editing.view;
		const viewDocument = view.document;

		// Pasting and dropping is disabled when editor is read-only.
		// See: https://github.com/ckeditor/ckeditor5-clipboard/issues/26.
		this.listenTo( viewDocument, 'clipboardInput', evt => {
			if ( editor.isReadOnly ) {
				evt.stop();
			}
		}, { priority: 'highest' } );

		this.listenTo( viewDocument, 'clipboardInput', ( evt, data ) => {
			const dataTransfer = data.dataTransfer;
			let content = data.content || '';

			// Some feature could already inject content in the higher priority event handler (i.e., codeBlock).
			if ( !content ) {
				if ( dataTransfer.getData( 'text/html' ) ) {
					content = normalizeClipboardHtml( dataTransfer.getData( 'text/html' ) );
				} else if ( dataTransfer.getData( 'text/plain' ) ) {
					content = plainTextToHtml( dataTransfer.getData( 'text/plain' ) );
				}

				content = this.editor.data.htmlProcessor.toView( content );
			}

			const eventInfo = new EventInfo( this, 'inputTransformation' );

			this.fire( eventInfo, {
				content,
				dataTransfer,
				targetRanges: data.targetRanges,
				method: data.method
			} );

			// If CKEditor handled the input, do not bubble the original event any further.
			// This helps external integrations recognize that fact and act accordingly.
			// https://github.com/ckeditor/ckeditor5-upload/issues/92
			if ( eventInfo.stop.called ) {
				evt.stop();
			}

			view.scrollToTheSelection();
		}, { priority: 'low' } );

		this.listenTo( this, 'inputTransformation', ( evt, data ) => {
			if ( data.content.isEmpty ) {
				return;
			}

			const dataController = this.editor.data;

			// Convert the pasted content to a model document fragment.
			// The conversion is contextual, but in this case we need an "all allowed" context
			// and for that we use the $clipboardHolder item.
			const modelFragment = dataController.toModel( data.content, '$clipboardHolder' );

			if ( modelFragment.childCount == 0 ) {
				return;
			}

			evt.stop();

			// Fire content insertion event in a single change block to allow other handlers to run in the same block
			// without post-fixers called in between (i.e., the selection post-fixer).
			model.change( () => {
				this.fire( 'contentInsertion', {
					content: modelFragment,
					method: data.method,
					dataTransfer: data.dataTransfer,
					targetRanges: data.targetRanges
				} );
			} );
		}, { priority: 'low' } );

		this.listenTo( this, 'contentInsertion', ( evt, data ) => {
			data.resultRange = model.insertContent( data.content );
		}, { priority: 'low' } );
	}

	/**
	 * The clipboard copy/cut pipeline.
	 *
	 * @private
	 */
	_setupCopyCut() {
		const editor = this.editor;
		const modelDocument = editor.model.document;
		const view = editor.editing.view;
		const viewDocument = view.document;

		function onCopyCut( evt, data ) {
			const dataTransfer = data.dataTransfer;

			data.preventDefault();

			const content = editor.data.toView( editor.model.getSelectedContent( modelDocument.selection ) );

			viewDocument.fire( 'clipboardOutput', { dataTransfer, content, method: evt.name } );
		}

		this.listenTo( viewDocument, 'copy', onCopyCut, { priority: 'low' } );
		this.listenTo( viewDocument, 'cut', ( evt, data ) => {
			// Cutting is disabled when editor is read-only.
			// See: https://github.com/ckeditor/ckeditor5-clipboard/issues/26.
			if ( editor.isReadOnly ) {
				data.preventDefault();
			} else {
				onCopyCut( evt, data );
			}
		}, { priority: 'low' } );

		this.listenTo( viewDocument, 'clipboardOutput', ( evt, data ) => {
			if ( !data.content.isEmpty ) {
				data.dataTransfer.setData( 'text/html', this.editor.data.htmlProcessor.toData( data.content ) );
				data.dataTransfer.setData( 'text/plain', viewToPlainText( data.content ) );
			}

			if ( data.method == 'cut' ) {
				editor.model.deleteContent( modelDocument.selection );
			}
		}, { priority: 'low' } );
	}
}

/**
 * Fired with the `content`, `dataTransfer`, `method`, and `targetRanges` properties:
 *
 * * The `content` which comes from the clipboard (was pasted or dropped) should be processed in order to be inserted into the editor.
 * * The `dataTransfer` object is available in case transformation functions need access to the raw clipboard data.
 * * The `method` indicates the original DOM event (for example `'drop'` or `'paste'`).
 * * The `targetRanges` is an array of view ranges (it is available only for `'drop'`).
 *
 * It is a part of the {@glink framework/guides/deep-dive/clipboard#input-pipeline "clipboard input pipeline"}.
 *
 * **Note**: You should not stop this event if you want to change the input data. You should modify the `content` property instead.
 *
 * @see module:clipboard/clipboardobserver~ClipboardObserver
 * @see module:clipboard/clipboardpipeline~ClipboardPipeline
 * @event module:clipboard/clipboardpipeline~ClipboardPipeline#event:inputTransformation
 * @param {Object} data Event data.
 * @param {module:engine/view/documentfragment~DocumentFragment} data.content Event data. Content to be inserted into the editor.
 * It can be modified by the event listeners. Read more about the clipboard pipelines in
 * {@glink framework/guides/deep-dive/clipboard "Clipboard" deep dive}.
 * @param {module:clipboard/datatransfer~DataTransfer} data.dataTransfer Data transfer instance.
 * @param {'paste'|'drop'} data.method Whether the event was triggered by a paste or drop operation.
 * @param {Array.<module:engine/view/range~Range>} data.targetRanges Target drop ranges.
 */

/**
 * Fired with the `content`, `dataTransfer`, `method`, and `targetRanges` properties:
 *
 * * The `content` which comes from the clipboard (was pasted or dropped) should be processed in order to be inserted into the editor.
 * * The `dataTransfer` object is available in case transformation functions need access to the raw clipboard data.
 * * The `method` indicates the original DOM event (for example `'drop'` or `'paste'`).
 * * The `targetRanges` is an array of view ranges (it is available only for `'drop'`).
 *
 * Event handlers can modify the content according to the final insertion position.
 *
 * It is a part of the {@glink framework/guides/deep-dive/clipboard#input-pipeline "clipboard input pipeline"}.
 *
 * **Note**: You should not stop this event if you want to change the input data. You should modify the `content` property instead.
 *
 * @see module:clipboard/clipboardobserver~ClipboardObserver
 * @see module:clipboard/clipboardpipeline~ClipboardPipeline
 * @see module:clipboard/clipboardpipeline~ClipboardPipeline#event:inputTransformation
 * @event module:clipboard/clipboardpipeline~ClipboardPipeline#event:contentInsertion
 * @param {Object} data Event data.
 * @param {module:engine/model/documentfragment~DocumentFragment} data.content Event data. Content to be inserted into the editor.
 * Read more about the clipboard pipelines in {@glink framework/guides/deep-dive/clipboard "Clipboard" deep dive}.
 * @param {module:clipboard/datatransfer~DataTransfer} data.dataTransfer Data transfer instance.
 * @param {'paste'|'drop'} data.method Whether the event was triggered by a paste or drop operation.
 * @param {Array.<module:engine/view/range~Range>} data.targetRanges Target drop ranges.
 * @param {module:engine/model/range~Range} data.resultRange The result of `model.insertContent()` call (inserted by the event handler
 *  at low priority).
 */

/**
 * Fired on {@link module:engine/view/document~Document#event:copy} and {@link module:engine/view/document~Document#event:cut}
 * with a copy of selected content. The content can be processed before it ends up in the clipboard.
 *
 * It is a part of the {@glink framework/guides/deep-dive/clipboard#output-pipeline "clipboard output pipeline"}.
 *
 * @see module:clipboard/clipboardobserver~ClipboardObserver
 * @see module:clipboard/clipboardpipeline~ClipboardPipeline
 * @event module:engine/view/document~Document#event:clipboardOutput
 * @param {module:clipboard/clipboardpipeline~ClipboardOutputEventData} data Event data.
 */

/**
 * The value of the {@link module:engine/view/document~Document#event:clipboardOutput} event.
 *
 * @class module:clipboard/clipboardpipeline~ClipboardOutputEventData
 */

/**
 * Data transfer instance.
 *
 * @readonly
 * @member {module:clipboard/datatransfer~DataTransfer} module:clipboard/clipboardpipeline~ClipboardOutputEventData#dataTransfer
 */

/**
 * Content to be put into the clipboard. It can be modified by the event listeners.
 * Read more about the clipboard pipelines in {@glink framework/guides/deep-dive/clipboard "Clipboard" deep dive}.
 *
 * @member {module:engine/view/documentfragment~DocumentFragment} module:clipboard/clipboardpipeline~ClipboardOutputEventData#content
 */

/**
 * Whether the event was triggered by a copy or cut operation.
 *
 * @member {'copy'|'cut'} module:clipboard/clipboardpipeline~ClipboardOutputEventData#method
 */
