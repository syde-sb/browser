import { ipcMain } from 'electron';
import { VIEW_Y_OFFSET } from '~/constants/design';
import { View } from './view';
import { AppWindow } from './windows';
import { WEBUI_BASE_URL } from '~/constants/files';

import {
  ZOOM_FACTOR_MIN,
  ZOOM_FACTOR_MAX,
  ZOOM_FACTOR_INCREMENT,
} from '~/constants/web-contents';
import { extensions } from 'electron-extensions';

export class ViewManager {
  public views = new Map<number, View>();
  public selectedId = 0;
  public _fullscreen = false;

  public incognito: boolean;

  private window: AppWindow;

  public get fullscreen() {
    return this._fullscreen;
  }

  public set fullscreen(val: boolean) {
    this._fullscreen = val;
    this.fixBounds();
  }

  public constructor(window: AppWindow, incognito: boolean) {
    this.window = window;
    this.incognito = incognito;

    const { id } = window.win;
    ipcMain.handle(`view-create-${id}`, (e, details) => {
      return this.create(details, false, false).id;
    });

    ipcMain.handle(`views-create-${id}`, (e, options) => {
      return options.map((option: any) => {
        return this.create(option, false, false).id;
      });
    });

    ipcMain.on(`add-tab-${id}`, (e, details) => {
      this.create(details);
    });

    ipcMain.on('Print', (e, details) => {
      this.views.get(this.selectedId).webContents.print();
    });

    ipcMain.handle(`view-select-${id}`, (e, id: number, focus: boolean) => {
      extensions.tabs.activate(id, focus);
    });

    ipcMain.on(`view-destroy-${id}`, (e, id: number) => {
      this.destroy(id);
    });

    ipcMain.on(`mute-view-${id}`, (e, tabId: number) => {
      const view = this.views.get(tabId);
      view.webContents.setAudioMuted(true);
    });

    ipcMain.on(`unmute-view-${id}`, (e, tabId: number) => {
      const view = this.views.get(tabId);
      view.webContents.setAudioMuted(false);
    });

    ipcMain.on(`browserview-clear-${id}`, () => {
      this.clear();
    });

    ipcMain.on('change-zoom', (e, zoomDirection) => {
      const newZoomFactor =
        this.selected.webContents.zoomFactor +
        (zoomDirection === 'in'
          ? ZOOM_FACTOR_INCREMENT
          : -ZOOM_FACTOR_INCREMENT);

      if (
        newZoomFactor <= ZOOM_FACTOR_MAX &&
        newZoomFactor >= ZOOM_FACTOR_MIN
      ) {
        this.selected.webContents.zoomFactor = newZoomFactor;
        this.selected.emitEvent(
          'zoom-updated',
          this.selected.webContents.zoomFactor,
        );
      } else {
        e.preventDefault();
      }
      this.emitZoomUpdate();
    });

    ipcMain.on('reset-zoom', (e) => {
      this.selected.webContents.zoomFactor = 1;
      this.selected.emitEvent(
        'zoom-updated',
        this.selected.webContents.zoomFactor,
      );
      this.emitZoomUpdate();
    });
  }

  public get selected() {
    return this.views.get(this.selectedId);
  }

  public get settingsView() {
    return Object.values(this.views).find((r) =>
      r.url.startsWith(`${WEBUI_BASE_URL}settings`),
    );
  }

  public create(
    details: chrome.tabs.CreateProperties,
    isNext = false,
    sendMessage = true,
  ) {
    const view = new View(this.window, details.url, this.incognito);

    const { webContents } = view.browserView;
    const { id } = view;

    this.views.set(id, view);

    extensions.tabs.observe(webContents);

    webContents.once('destroyed', () => {
      this.views.delete(id);
    });

    if (sendMessage) {
      this.window.send('create-tab', { ...details }, isNext, id);
    }

    return view;
  }

  public clear() {
    this.window.win.setBrowserView(null);
    Object.values(this.views).forEach((x) => x.destroy());
  }

  public select(id: number, focus = true) {
    const { selected } = this;
    const view = this.views.get(id);

    if (!view) {
      return;
    }

    this.selectedId = id;

    if (selected) {
      this.window.win.removeBrowserView(selected.browserView);
    }

    this.window.win.addBrowserView(view.browserView);

    if (focus) {
      // Also fixes switching tabs with Ctrl + Tab
      view.webContents.focus();
    } else {
      this.window.webContents.focus();
    }

    this.window.dialogs.previewDialog.hide(true);

    [
      'findDialog',
      'authDialog',
      'permissionsDialog',
      'formFillDialog',
      'credentialsDialog',
    ].forEach((dialog) => {
      if (this.window.dialogs[dialog].tabIds.includes(id)) {
        this.window.dialogs[dialog].show();
        this.window.dialogs[dialog].bringToTop();
      } else {
        this.window.dialogs[dialog].hide();
      }
    });

    this.window.updateTitle();
    view.updateBookmark();

    this.fixBounds();

    view.updateNavigationState();

    this.emitZoomUpdate(false);
  }

  public fixBounds() {
    const view = this.selected;

    if (!view) return;

    const { width, height } = this.window.win.getContentBounds();

    const newBounds = {
      x: 0,
      y: this.fullscreen ? 0 : VIEW_Y_OFFSET,
      width,
      height: this.fullscreen ? height : height - VIEW_Y_OFFSET,
    };

    if (newBounds !== view.bounds) {
      view.browserView.setBounds(newBounds);
      view.bounds = newBounds;
    }
  }

  public destroy(id: number) {
    const view = this.views.get(id);

    if (view && !view.browserView.isDestroyed()) {
      this.window.win.removeBrowserView(view.browserView);
      view.destroy();
    }
  }

  public emitZoomUpdate(showDialog: boolean = true) {
    this.window.dialogs.zoomDialog.send(
      'zoom-factor-updated',
      this.selected.webContents.zoomFactor
    );
    this.window.webContents.send(
      'zoom-factor-updated',
      this.selected.webContents.zoomFactor,
      showDialog,
    );
  }
}
