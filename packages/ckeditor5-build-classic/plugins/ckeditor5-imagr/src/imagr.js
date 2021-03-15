import Plugin from '@ckeditor/ckeditor5-core/src/plugin';
import ImagrUI from './imagrui';

export default class Imagr extends Plugin {
    /**
	 * @inheritDoc
	 */
    static get requires() {
        return [ImagrUI];
    }

	/**
	 * @inheritDoc
	 */
    static get pluginName() {
        return 'Imagr';
    }
}