import Plugin from '@ckeditor/ckeditor5-core/src/plugin';
import ButtonView from '@ckeditor/ckeditor5-ui/src/button/buttonview';
import imageIcon from '@ckeditor/ckeditor5-core/theme/icons/image.svg';

export default class ImagrUI extends Plugin {
    /**
	 * @inheritDoc
	 */
    init() {
        const editor = this.editor;
        const t = editor.t;

        // Setup `imagr` button.
        editor.ui.componentFactory.add('imagr', locale => {
            const view = new ButtonView(locale);

            view.set({
                label: t('Insert image'),
                icon: imageIcon,
                keystroke: 'CTRL+M',
                tooltip: true
            });

            // On imagr button click
            this.listenTo(view, 'execute', () => {
                app.mediaDialogVisible = true;
            });

            return view;
        });
    }

    /**
     * To open OS file dialog to select your images.
     */
    // _openFileDialog() {
    //     const input = document.createElement('input');
    //     input.setAttribute('type', 'file');
    //     input.setAttribute('accept', 'image/*');
    //     input.setAttribute('multiple', null);
    //     input.click();
    //     input.onchange = () => {
    //         const formData = new FormData();
    //         for (let i = 0; i < input.files.length; i++) {
    //             formData.append('images', input.files[i]);
    //         }

    //         axios.post('/admin/media?handler=image', formData, { headers: { 'XSRF-TOKEN': this.$root.tok } })
    //             .then(resp => {
    //                 this.images = resp.data.images;
    //             })
    //             .catch(err => {
    //                 console.log(err);
    //             });
    //     };
    // }
}

