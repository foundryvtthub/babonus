import {
  ARBITRARY_OPERATORS,
  BONUS_TYPES_FORMDATA,
  EQUIPPABLE_TYPES,
  FILTER_NAMES,
  ITEM_ROLL_TYPES,
  MODULE,
  MODULE_ICON,
  MODULE_NAME,
  TYPES
} from "../constants.mjs";
import {KeyGetter} from "../helpers/helpers.mjs";
import {ConsumptionDialog} from "./consumptionApp.mjs";
import {AuraConfigurationDialog} from "./auraConfigurationApp.mjs";
import {BabonusKeysDialog} from "./keysDialog.mjs";
import {AttackBabonus, DamageBabonus, HitDieBabonus, SaveBabonus, TestBabonus, ThrowBabonus} from "./dataModel.mjs";

export class BabonusWorkshop extends FormApplication {

  /**
   * ----------------------------------------------------
   *
   *
   *                      VARIABLES
   *
   *
   * ----------------------------------------------------
   */

  // The right-hand side bonuses that have a collapsed description.
  _collapsedBonuses = new Set();

  // The ids of the filters that have been added.
  _addedFilters = new Set();

  // The color of the left-side otter.
  _otterColor = "black";

  // The type of babonus being created.
  _type = null;

  // The currently selected item types for the 'itemTypes' filter.
  _itemTypes = new Set();

  // The current babonus being edited.
  _bab = null;

  constructor(object, options) {
    super(object, options);
    this.isItem = object.documentName === "Item";
    this.isEffect = object.documentName === "ActiveEffect";
    this.isActor = object.documentName === "Actor";
    this.appId = `${this.object.uuid.replaceAll(".", "-")}-babonus-workshop`;
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      closeOnSubmit: false,
      width: 900,
      height: 850,
      template: `modules/${MODULE}/templates/babonus.hbs`,
      classes: [MODULE, "builder"],
      scrollY: [".current-bonuses .bonuses", "div.available-filters", "div.unavailable-filters"],
      dragDrop: [{dragSelector: ".label[data-action='current-collapse']", dropSelector: ".current-bonuses .bonuses"}],
      resizable: true
    });
  }

  get id() {
    return `${MODULE}-${this.object.id}`;
  }

  get isEditable() {
    return this.object.sheet.isEditable;
  }

  get title() {
    return `${MODULE_NAME}: ${this.object.name}`;
  }

  /**
   * ----------------------------------------------------
   *
   *
   *                      OVERRIDES
   *
   *
   * ----------------------------------------------------
   */

  /** @override */
  async getData() {
    const data = await super.getData();

    data.isItem = this.isItem;
    data.isEffect = this.isEffect;
    data.isActor = this.isActor;
    data.activeBuilder = !!(this._type || this._bab);

    if (data.isItem) {
      data.canEquip = this._canEquipItem(this.object);
      data.canAttune = this._canAttuneToItem(this.object);
      data.canConfigureTemplate = this.object.hasAreaTarget;
    }

    // Initial values of the filters.
    data.filters = [];

    if (this._bab) {
      // Editing a babonus.
      data.builder = {
        type: TYPES.find(t => t.value === this._bab.type),
        id: this._bab.id,
        intro: "BABONUS.EditingBonus",
        name: this._bab.name,
        description: this._bab.description
      };
      data._filters = this._filters;
      delete this._filters;
      data.bonuses = BONUS_TYPES_FORMDATA[this._bab.type].map(b => {
        return {value: foundry.utils.getProperty(this._bab, b.NAME), ...b};
      });
    } else if (this._type) {
      // Creating a babonus.
      data.builder = {
        type: TYPES.find(t => t.value === this._type),
        id: foundry.utils.randomID(),
        intro: "BABONUS.CreatingBonus",
        name: null,
        description: null
      };
      data.bonuses = BONUS_TYPES_FORMDATA[this._type];
    }

    if (data.activeBuilder) {
      for (const id of FILTER_NAMES) {
        const filterData = {
          id,
          header: `BABONUS.Filters${id.capitalize()}`,
          description: `BABONUS.Filters${id.capitalize()}Tooltip`,
          requirements: `BABONUS.Filters${id.capitalize()}Requirements`
        };

        // Set 'available' to true to display it in the available filters.
        filterData.available = this._isFilterAvailable(id);
        // Set 'unavailable' to true to hide it in the 'unavailable' filters.
        filterData.unavailable = filterData.available || (this._addedFilters.has(id) && (id !== "arbitraryComparisons"));

        data.filters.push(filterData);
      }
      data.filters.sort((a, b) => a.header.localeCompare(b.header, game.i18n.lang));
    }

    // Get current bonuses on the document.
    const flagBoni = [];
    for (const [id, babData] of Object.entries(this.object.flags[MODULE]?.bonuses ?? {})) {
      try {
        const bab = this.constructor._createBabonus(babData, id, {parent: this.object});
        bab._collapsed = this._collapsedBonuses.has(id);
        bab._description = await TextEditor.enrichHTML(bab.description, {
          async: true,
          rollData: bab.origin?.getRollData() ?? {}
        });
        // Add the icon property to the bonus object
        const bonusType = TYPES.find(t => t.value === bab.type);
        bab.icon = bonusType.icon;
        bab.typeTooltip = bonusType.label;
        flagBoni.push(bab);
      } catch (err) {
        console.error(err);
      }
    }
    // Sort the bonuses alphabetically by name
    data.currentBonuses = flagBoni.sort((a, b) => a.name.localeCompare(b.name));
    data.TYPES = TYPES;
    data.ICON = MODULE_ICON;
    data.otterColor = this._otterColor;
    return data;
  }

  /** @override */
  async _updateObject(event, formData) {
    if (this._bab) {
      // If editing, get some values from the old babonus.
      formData.id = this._bab.id;
      formData.type = this._bab.type;
      formData.itemOnly = this._bab.itemOnly;
      formData.optional = this._bab.optional;
      formData.consume = this._bab.consume;
      formData.aura = this._bab.aura;
    } else {
      // Generate some default value(s).
      formData.id = this.element[0].querySelector("[name='id']").value;
      formData.type = this._type;
    }

    // Attempt to save the babonus, otherwise show a warning.
    try {
      const bab = this.constructor._createBabonus(formData, formData.id);
      await this.object.update({[`flags.${MODULE}.bonuses.-=${formData.id}`]: null}, {render: false});
      await this.object.setFlag(MODULE, `bonuses.${formData.id}`, bab.toObject());
      ui.notifications.info(game.i18n.format("BABONUS.NotificationSave", {name: formData.name, id: formData.id}));
    } catch (err) {
      console.warn(err);
      this._displayWarning();
      return;
    }
  }

  /** @override */
  activateListeners(html) {
    // Otter.
    html[0].querySelector("[data-action='otter-rainbow']").addEventListener("click", this._onOtterRainbow.bind(this));
    html[0].querySelector("[data-action='otter-dance']").addEventListener("click", this._onOtterDance.bind(this));
    html[0].querySelectorAll("[data-action='current-collapse']").forEach(a => a.addEventListener("click", this._onCollapseBonus.bind(this)));

    if (!this.isEditable) {
      html[0].querySelectorAll(".left-side, .right-side .functions").forEach(n => {
        n.style.pointerEvents = "none";
        n.classList.add("locked");
      });
      return;
    }
    super.activateListeners(html);

    // Builder methods.
    html[0].querySelector("[data-action='cancel']").addEventListener("click", this._onCancelBuilder.bind(this));
    html[0].querySelectorAll("[data-action='keys-dialog']").forEach(a => a.addEventListener("click", this._onDisplayKeysDialog.bind(this)));
    html[0].querySelectorAll("[data-action='pick-type']").forEach(a => a.addEventListener("click", this._onPickType.bind(this)));
    html[0].querySelectorAll("[data-action='delete-filter']").forEach(a => a.addEventListener("click", this._onDeleteFilter.bind(this)));
    html[0].querySelectorAll("[data-action='add-filter']").forEach(a => a.addEventListener("click", this._onAddFilter.bind(this)));
    html[0].querySelector("[data-action='dismiss-warning']").addEventListener("click", this._onDismissWarning.bind(this));
    html[0].querySelectorAll("[data-action='item-type']").forEach(a => a.addEventListener("change", this._onPickItemType.bind(this)));
    html[0].querySelectorAll("[data-action='section-collapse']").forEach(a => a.addEventListener("click", this._onSectionCollapse.bind(this)));

    // Current bonuses.
    html[0].querySelectorAll("[data-action='current-toggle']").forEach(a => a.addEventListener("click", this._onToggleBonus.bind(this)));
    html[0].querySelectorAll("[data-action='current-copy']").forEach(a => a.addEventListener("click", this._onCopyBonus.bind(this)));
    html[0].querySelectorAll("[data-action='current-edit']").forEach(a => a.addEventListener("click", this._onEditBonus.bind(this)));
    html[0].querySelectorAll("[data-action='current-delete']").forEach(a => a.addEventListener("click", this._onDeleteBonus.bind(this)));
    html[0].querySelectorAll("[data-action='current-aura']").forEach(a => a.addEventListener("click", this._onToggleAura.bind(this)));
    html[0].querySelectorAll("[data-action='current-aura']").forEach(a => a.addEventListener("contextmenu", this._onToggleAura.bind(this)));
    html[0].querySelectorAll("[data-action='current-optional']").forEach(a => a.addEventListener("click", this._onToggleOptional.bind(this)));
    html[0].querySelectorAll("[data-action='current-consume']").forEach(a => a.addEventListener("click", this._onToggleConsume.bind(this)));
    html[0].querySelectorAll("[data-action='current-consume']").forEach(a => a.addEventListener("contextmenu", this._onToggleConsume.bind(this)));
    html[0].querySelectorAll("[data-action='current-itemOnly']").forEach(a => a.addEventListener("click", this._onToggleExclusive.bind(this)));
    html[0].querySelectorAll("[data-action='current-id']").forEach(a => a.addEventListener("click", this._onClickId.bind(this)));
    html[0].querySelectorAll("[data-action='current-id']").forEach(a => a.addEventListener("contextmenu", this._onClickId.bind(this)));
  }

  /** @override */
  _onDragStart(event) {
    const label = event.currentTarget.closest(".bonus");
    let dragData;
    if (label.dataset.id) {
      const bab = this.constructor._getCollection(this.object).get(label.dataset.id);
      dragData = bab.toDragData();
    }
    if (!dragData) return;
    event.dataTransfer.setData("text/plain", JSON.stringify(dragData));
  }

  /** @override */
  async _onDrop(event) {
    const data = TextEditor.getDragEventData(event);
    const doc = this.object;
    if (!this.isEditable) return false;
    if (doc.uuid === data.uuid) return false;
    const bab = await this._fromDropData(data);
    return doc.setFlag(MODULE, `bonuses.${bab.id}`, bab.toObject());
  }

  /**
   * Turn drop data into a babonus.
   * @param {object} data     An object of babonus data or a uuid.
   * @returns {Babonus}       The created babonus.
   */
  async _fromDropData(data) {
    if (data.data) {
      return this.constructor._createBabonus(data.data, null, {parent: this.object});
    } else if (data.uuid) {
      const parent = await fromUuid(data.uuid);
      const babData = this.constructor._getCollection(parent).get(data.babId).toObject();
      delete babData.id;
      return this.constructor._createBabonus(babData, null, {parent: this.object});
    }
  }

  /**
   * ----------------------------------------------------
   *
   *
   *                   RENDERING METHODS
   *
   *
   * ----------------------------------------------------
   */

  /**
   * Special implementation of rendering, to reset the entire application to a clean state.
   * @param {PointerEvent} event      The initiating click event.
   * @returns {BabonusWorkshop}       This application.
   */
  async _renderClean(event) {
    this._type = null;
    this._bab = null;
    this._addedFilters.clear();
    this._itemTypes.clear();
    delete this._filters; // appended formgroups for editor mode purposes.
    return super.render(false);
  }

  /**
   * Special implementation of rendering, for when entering creation mode.
   * @param {PointerEvent} event      The initiating click event.
   * @returns {BabonusWorkshop}       This application.
   */
  async _renderCreator(event) {
    this._type = event.currentTarget.dataset.type;
    this._bab = null;
    this._addedFilters.clear();
    this._itemTypes.clear();
    delete this._filters; // appended formgroups for editor mode purposes.
    return super.render(false);
  }

  /**
   * Special implementation of rendering, for when entering edit mode.
   * @param {PointerEvent} event      The initiating click event.
   * @returns {BabonusWorkshop}       This application.
   */
  async _renderEditor(event) {
    const id = event.currentTarget.closest(".bonus").dataset.id;
    const data = this.object.flags[MODULE].bonuses[id];
    this._type = null;
    this._bab = this.constructor._createBabonus(data, id, {strict: true});
    const formData = this._bab.toString();
    this._addedFilters = new Set(Object.keys(foundry.utils.expandObject(formData).filters ?? {}));
    this._itemTypes = new Set(this._bab.filters.itemTypes ?? []);

    // Create the form groups for each active filter.
    const DIV = document.createElement("DIV");
    DIV.innerHTML = "";
    for (const id of this._addedFilters) {
      DIV.innerHTML += await this._templateFilter(id, formData);
    }
    this._filters = DIV.innerHTML;

    return super.render(false);
  }

  /** @override */
  async render(force = false, options = {}) {
    // To automatically render in a clean state, the reason
    // for rendering must either be due to an update in the
    // object's babonus flags, or 'force' must explicitly be set to 'true'.
    const wasBabUpdate = foundry.utils.hasProperty(options, `data.flags.${MODULE}`);
    if (!(wasBabUpdate || force)) return;
    this._type = null;
    this._bab = null;
    delete this._filters; // appended formgroups for editor mode purposes.
    this._addedFilters.clear();
    this._itemTypes.clear();
    this.object.apps[this.appId] = this;
    return super.render(force, options);
  }

  /** @override */
  close(...T) {
    super.close(...T);
    delete this.object.apps[this.appId];
  }

  /**
   * ----------------------------------------------------
   *
   *
   *                CURRENT BONUSES METHODS
   *
   *
   * ----------------------------------------------------
   */

  /**
   * Otter Rainbow.
   * @param {PointerEvent} event      The initiating click event.
   */
  _onOtterRainbow(event) {
    this._otterColor = "#" + Math.floor(Math.random() * 16777215).toString(16);
    event.currentTarget.style.color = this._otterColor;
  }

  /**
   * Otter Dance.
   * @param {PointerEvent} event      The initiating click event.
   */
  _onOtterDance(event) {
    const spin = [{transform: 'rotate(0)'}, {transform: 'rotate(360deg)'}];
    const time = {duration: 1000, iterations: 1};
    if (!event.currentTarget.getAnimations().length) event.currentTarget.animate(spin, time);
  }

  /**
   * Collapse or expand a babonus and its description.
   * @param {PointerEvent} event      The initiating click event.
   */
  _onCollapseBonus(event) {
    const bonus = event.currentTarget.closest(".bonus");
    const id = bonus.dataset.id;
    const has = this._collapsedBonuses.has(id);
    bonus.classList.toggle("collapsed", !has);
    if (has) this._collapsedBonuses.delete(id);
    else this._collapsedBonuses.add(id);
  }

  /**
   * Handle copying the id or uuid of a babonus.
   * @param {PointerEvent} event      The initiating click event.
   */
  async _onClickId(event) {
    const bonus = this.constructor._getCollection(this.object).get(event.currentTarget.closest(".bonus").dataset.id);
    const id = (event.type === "contextmenu") ? bonus.uuid : bonus.id;
    await game.clipboard.copyPlainText(id);
    ui.notifications.info(game.i18n.format("DOCUMENT.IdCopiedClipboard", {
      id, label: "Babonus", type: event.type === "contextmenu" ? "uuid" : "id"
    }));
  }

  /**
   * Delete a babonus on the builder when hitting its trashcan icon. This resets the UI entirely.
   * @param {PointerEvent} event            The initiating click event.
   * @returns {Promise<Actor5e|Item5e>}     The actor or item having its babonus deleted.
   */
  async _onDeleteBonus(event) {
    const id = event.currentTarget.closest(".bonus").dataset.id;
    const name = this.object.flags[MODULE].bonuses[id].name;
    const prompt = await Dialog.confirm({
      title: game.i18n.format("BABONUS.ConfigurationDeleteTitle", {name}),
      content: game.i18n.format("BABONUS.ConfigurationDeleteAreYouSure", {name}),
      options: {id: `babonus-confirm-delete-${id}`}
    });
    if (!prompt) return false;
    ui.notifications.info(game.i18n.format("BABONUS.NotificationDelete", {name, id}));
    return this.object.unsetFlag(MODULE, `bonuses.${id}`);
  }

  /**
   * Toggle the aura configuration of the babonus on or off, or open the config dialog.
   * @param {PointerEvent} event                                    The initiating click event.
   * @returns {Promise<Actor5e|Item5e|AuraConfigurationDialog>}     The actor, item, or aura config.
   */
  async _onToggleAura(event) {
    const id = event.currentTarget.closest(".bonus").dataset.id;
    const bab = this.constructor._getCollection(this.object).get(id);
    const path = `bonuses.${id}.aura.enabled`;
    // Right-click always shows the application.
    if (event.type === "contextmenu") return new AuraConfigurationDialog(this.object, {bab, builder: this}).render(true);
    if (bab.isTemplateAura || bab.isTokenAura) return this.object.setFlag(MODULE, path, false);
    else if (event.shiftKey) return this.object.setFlag(MODULE, path, !bab.aura.enabled);
    return new AuraConfigurationDialog(this.object, {bab, builder: this}).render(true);
  }

  /**
   * Toggle the exclusivity property on a babonus.
   * @param {PointerEvent} event            The initiating click event.
   * @returns {Promise<Actor5e|Item5e>}     The actor or item having its babonus toggled.
   */
  async _onToggleExclusive(event) {
    const id = event.currentTarget.closest(".bonus").dataset.id;
    const state = this.object.flags[MODULE].bonuses[id].itemOnly;
    return this.object.setFlag(MODULE, `bonuses.${id}.itemOnly`, !state);
  }

  /**
   * Toggle the consumption property on a babonus.
   * @param {PointerEvent} event                              The initiating click event.
   * @returns {Promise<Actor5e|Item5e|ConsumptionDialog>}     The actor, item, or consumption config.
   */
  async _onToggleConsume(event) {
    const id = event.currentTarget.closest(".bonus").dataset.id;
    const bab = this.constructor._getCollection(this.object).get(id);
    const path = `bonuses.${id}.consume.enabled`;
    // Right-click always shows the application.
    if (event.type === "contextmenu") return new ConsumptionDialog(this.object, {bab}).render(true);
    if (bab.isConsuming) return this.object.setFlag(MODULE, path, false);
    else if (event.shiftKey) return this.object.setFlag(MODULE, path, !bab.consume.enabled);
    return new ConsumptionDialog(this.object, {bab}).render(true);
  }

  /**
   * Toggle the optional property on a babonus.
   * @param {PointerEvent} event            The initiating click event.
   * @returns {Promise<Actor5e|Item5e>}     The actor or item having its babonus toggled.
   */
  async _onToggleOptional(event) {
    const id = event.currentTarget.closest(".bonus").dataset.id;
    const state = this.object.flags[MODULE].bonuses[id].optional;
    return this.object.setFlag(MODULE, `bonuses.${id}.optional`, !state);
  }

  /**
   * Toggle the enabled property on a babonus.
   * @param {PointerEvent} event            The initiating click event.
   * @returns {Promise<Actor5e|Item5e>}     The actor or item having its babonus toggled.
   */
  async _onToggleBonus(event) {
    const id = event.currentTarget.closest(".bonus").dataset.id;
    const state = this.object.flags[MODULE].bonuses[id].enabled;
    return this.object.setFlag(MODULE, `bonuses.${id}.enabled`, !state);
  }

  /**
   * Copy a babonus on the actor or item.
   * @param {PointerEvent} event            The initiating click event.
   * @returns {Promise<Actor5e|Item5e>}     The actor or item having its babonus copied.
   */
  async _onCopyBonus(event) {
    const id = event.currentTarget.closest(".bonus").dataset.id;
    const data = foundry.utils.deepClone(this.object.flags[MODULE].bonuses[id]);
    data.name = game.i18n.format("BABONUS.BonusCopy", {name: data.name});
    data.id = foundry.utils.randomID();
    data.enabled = false;
    ui.notifications.info(game.i18n.format("BABONUS.NotificationCopy", data));
    return this.object.setFlag(MODULE, `bonuses.${data.id}`, data);
  }

  /**
   * Edit a babonus by adding it to the builder. This also sets all related stored values.
   * @param {PointerEvent} event              The initiating click event.
   * @returns {Promise<BabonusWorkshop>}      This application.
   */
  async _onEditBonus(event) {
    // Render the application specifically in this mode.
    return this._renderEditor(event);
  }

  /**
   * ----------------------------------------------------
   *
   *                 FILTER PICKER AND
   *                  BUILDER METHODS
   *
   *
   * ----------------------------------------------------
   */

  /**
   * Collapse a section in the builder.
   * @param {PointerEvent} event      The initiating click event.
   */
  _onSectionCollapse(event) {
    event.currentTarget.closest("header").classList.toggle("collapsed");
  }

  /**
   * Helper function to display the keys dialog and subsequently place the
   * selected values in the input fields that its button was placed near.
   * @param {PointerEvent} event      The initiating click event.
   */
  async _onDisplayKeysDialog(event) {
    const formGroup = event.currentTarget.closest(".form-group");
    const filterId = formGroup.dataset.id;

    const list = foundry.utils.deepClone(KeyGetter[filterId]);

    // The text input.
    const values = formGroup.querySelector("input[type='text']").value.split(";");
    /* If the keys dialog also has 'exclude' as an option for this filter type, add it here: */
    const canExclude = [
      "baseArmors",
      "baseTools",
      "baseWeapons",
      "creatureTypes",
      "damageTypes",
      "skillIds",
      "statusEffects",
      "targetEffects",
      "weaponProperties"
    ].includes(filterId);

    for (let value of values) {
      value = value.trim();
      const key = value.replaceAll("!", "");
      const val = list.find(e => e.value === key);
      if (!val) continue;
      if (value.startsWith("!")) val.exclude = true;
      else val.include = true;
    }

    const newValue = await BabonusKeysDialog.prompt({
      rejectClose: false,
      options: {filterId, appId: this.appId, values: list, canExclude},
      callback: function(html) {
        const selects = Array.from(html[0].querySelectorAll("select"));
        return selects.reduce((acc, select) => {
          if (select.value === "include") return `${acc}${select.dataset.value};`;
          else if (select.value === "exclude") return `${acc}!${select.dataset.value};`;
          else return acc;
        }, "");
      },
    });

    if (!newValue) return;
    formGroup.querySelector("input[type='text']").value = newValue;
  }

  /**
   * Dismiss the warning about invalid data.
   * @param {PointerEvent} event      The initiating click event.
   */
  _onDismissWarning(event) {
    event.currentTarget.classList.toggle("active", false);
  }

  /**
   * Show the warning about invalid data. This is usually just a missing name for the babonus.
   */
  _displayWarning() {
    this.element[0].querySelector("[data-action='dismiss-warning']").classList.toggle("active", true);
  }

  /**
   * Canceling out of the builder.
   * @param {PointerEvent} event      The initiating click event.
   * @returns {BabonusWorkshop}       This application.
   */
  _onCancelBuilder(event) {
    return this._renderClean(event);
  }

  /**
   * Deleting a filter by clicking the trashcan icon.
   * @param {PointerEvent} event      The initiating click event.
   */
  _onDeleteFilter(event) {
    if (event.currentTarget.closest(".form-group").dataset.id === "itemTypes") {
      this._itemTypes.clear();
    }
    event.currentTarget.closest(".form-group").remove();
    this._updateAddedFilters();
    this._updateFilterPicker();
  }

  /**
   * When picking a type to create a new babonus, store the type, remove
   * any stored bab, set the filters, and then toggle the builder on.
   * @param {PointerEvent} event      The initiating click event.
   */
  _onPickType(event) {
    this._renderCreator(event);
  }

  /**
   * When selecting or deselecting an item type in the 'itemTypes' filter, update the _itemTypes set to match.
   * @param {PointerEvent} event      The initiating change event.
   */
  _onPickItemType(event) {
    const {checked, value} = event.currentTarget;
    if (checked) this._itemTypes.add(value);
    else this._itemTypes.delete(value);
    this._updateFilterPicker();
  }

  /**
   * Update the 'addedFilters' set with what is found in the builder currently.
   */
  _updateAddedFilters() {
    this._addedFilters.clear();
    const added = this.element[0].querySelectorAll(".left-side .bonus-filters [data-id]");
    added.forEach(a => this._addedFilters.add(a.dataset.id));
  }

  /**
   * Update the filter picker by reading the 'addedFilters' set and toggling the hidden states.
   */
  _updateFilterPicker() {
    FILTER_NAMES.forEach(id => {
      const available = this._isFilterAvailable(id);
      const [av, unav] = this.element[0].querySelectorAll(`.right-side .filter[data-id="${id}"]`);
      av.classList.toggle("hidden", !available);
      unav.classList.toggle("hidden", available || this._addedFilters.has(id));
    });
  }

  /**
   * Handle the click event when adding a new filter to the builder.
   * @param {PointerEvent} event      The initiating click event.
   */
  async _onAddFilter(event) {
    const id = event.currentTarget.closest(".filter").dataset.id;
    await this._appendNewFilter(id);
    if (id === "itemTypes") this._itemTypes.clear();
    this._updateAddedFilters();
    this._updateFilterPicker();
  }

  /**
   * Append one specific filter to the builder.
   * @param {string} id     The id of the filter.
   */
  async _appendNewFilter(id) {
    const DIV = document.createElement("DIV");
    DIV.innerHTML = await this._templateFilter(id);
    this._appendListenersToFilters(DIV);
    this.element[0].querySelector(".left-side .bonus-filters").append(...DIV.children);
  }

  /**
   * Get the inner html of a filter you want to add.
   * @param {string} id                   The id of the filter.
   * @param {object} [formData=null]      The toString'd data of a babonus in case of one being edited.
   * @returns {string}                    The template.
   */
  async _templateFilter(id, formData = null) {
    if (id !== "arbitraryComparison") return this._templateFilterUnique(id, formData);
    else return this._templateFilterRepeatable(id, formData);
  }

  /**
   * Create and append the form-group for a specific filter, then add listeners.
   * @param {string} id           The id of the filter to add.
   * @param {object} formData     The toString'd data of a babonus in case of one being edited.
   * @returns {string}            The template.
   */
  async _templateFilterUnique(id, formData) {
    const data = {
      tooltip: `BABONUS.Filters${id.capitalize()}Tooltip`,
      label: `BABONUS.Filters${id.capitalize()}Label`,
      id,
      appId: this.object.id,
      array: this._newFilterArrayOptions(id),
      value: null
    };

    if (formData) this._prepareData(data, formData);

    const template = ("modules/babonus/templates/builder_components/" + {
      abilities: "text_keys.hbs",
      attackTypes: "checkboxes.hbs",
      baseArmors: "text_keys.hbs",
      baseTools: "text_keys.hbs",
      baseWeapons: "text_keys.hbs",
      creatureTypes: "text_keys.hbs",
      customScripts: "textarea.hbs",
      damageTypes: "text_keys.hbs",
      healthPercentages: "range_select.hbs",
      itemRequirements: "label_checkbox_label_checkbox.hbs",
      itemTypes: "checkboxes.hbs",
      preparationModes: "text_keys.hbs",
      remainingSpellSlots: "text_dash_text.hbs",
      saveAbilities: "text_keys.hbs",
      skillIds: "text_keys.hbs",
      spellComponents: "checkboxes_select.hbs",
      spellLevels: "checkboxes.hbs",
      spellSchools: "text_keys.hbs",
      statusEffects: "text_keys.hbs",
      targetEffects: "text_keys.hbs",
      throwTypes: "text_keys.hbs",
      tokenSizes: "select_number_checkbox.hbs",
      weaponProperties: "text_keys.hbs"
    }[id]);

    if (id === "spellComponents") {
      data.selectOptions = [
        {value: "ANY", label: "BABONUS.FiltersSpellComponentsMatchAny"},
        {value: "ALL", label: "BABONUS.FiltersSpellComponentsMatchAll"}
      ];
    } else if ("itemRequirements" === id) {
      data.canEquip = this._canEquipItem(this.object);
      data.canAttune = this._canAttuneToItem(this.object);
    } else if (id === "tokenSizes") {
      data.selectOptions = [
        {value: 0, label: "BABONUS.SizeGreaterThan"},
        {value: 1, label: "BABONUS.SizeSmallerThan"}
      ];
    } else if (id === "healthPercentages") {
      if (data.value === null) data.value = 50;
      data.selectOptions = [
        {value: 0, label: "BABONUS.OrLess"},
        {value: 1, label: "BABONUS.OrMore"}
      ];
    }
    return renderTemplate(template, data);
  }

  /**
   * Create and append the form-group for a specific repeatable filter, then add listeners.
   * @param {string} id           The id of the filter to add.
   * @param {object} formData     The toString'd data of a babonus in case of one being edited.
   * @returns {string}            The template.
   */
  async _templateFilterRepeatable(id, formData) {
    const idx = this.element[0].querySelectorAll(`.left-side [data-id="${id}"]`).length;
    const data = {
      tooltip: `BABONUS.Filters${id.capitalize()}Tooltip`,
      label: `BABONUS.Filters${id.capitalize()}Label`,
      id,
      defaultOptions: ARBITRARY_OPERATORS,
      placeholderOne: `BABONUS.Filters${id.capitalize()}One`,
      placeholderOther: `BABONUS.Filters${id.capitalize()}Other`,
      array: [{idx}]
    }
    if (formData) this._prepareData(data, formData);
    return renderTemplate("modules/babonus/templates/builder_components/text_select_text.hbs", data);
  }

  /**
   * Helper function to append listeners to created form-groups (filters).
   * @param {html} fg     The form-groups created.
   */
  _appendListenersToFilters(fg) {
    fg.querySelectorAll("[data-action='delete-filter']").forEach(n => n.addEventListener("click", this._onDeleteFilter.bind(this)));
    fg.querySelectorAll("[data-action='keys-dialog']").forEach(n => n.addEventListener("click", this._onDisplayKeysDialog.bind(this)));
    fg.querySelectorAll("[data-action='item-type']").forEach(a => a.addEventListener("change", this._onPickItemType.bind(this)));
  }

  /**
   * Helper function for array of options.
   * @param {string} id     The name attribute of the filter.
   */
  _newFilterArrayOptions(id) {
    if (id === "attackTypes") {
      return ["mwak", "rwak", "msak", "rsak"].map(a => ({value: a, label: a.toUpperCase(), tooltip: CONFIG.DND5E.itemActionTypes[a]}));
    } else if (id === "itemTypes") {
      return ITEM_ROLL_TYPES.map(i => ({value: i, label: i.slice(0, 4).toUpperCase(), tooltip: `ITEM.Type${i.titleCase()}`}));
    } else if (id === "spellLevels") {
      return Object.entries(CONFIG.DND5E.spellLevels).map(([value, tooltip]) => ({value, label: value, tooltip}));
    } else if (id === "spellComponents") {
      return Object.entries(CONFIG.DND5E.spellComponents).concat(Object.entries(CONFIG.DND5E.spellTags)).map(([key, {abbr, label}]) => ({value: key, label: abbr, tooltip: label}));
    }
  }

  /**
   * Prepare previous values, checked boxes, etc., for a created form-group when a babonus is edited.
   * @param {object} data         The pre-mutated object of handlebars data. **will be mutated**
   * @param {object} formData     The toString'd data of a babonus in case of one being edited.
   */
  _prepareData(data, formData) {
    if (data.id === "arbitraryComparison") {
      data.array = foundry.utils.deepClone(this._bab.filters[data.id]).map((n, idx) => {
        const options = ARBITRARY_OPERATORS.reduce((acc, {value, label}) => {
          const selected = (value === n.operator) ? "selected" : "";
          return acc + `<option value="${value}" ${selected}>${label}</option>`;
        }, "");
        return {...n, idx, options};
      });
    } else if ([
      "abilities",
      "baseArmors",
      "baseTools",
      "baseWeapons",
      "creatureTypes",
      "customScripts",
      "damageTypes",
      "preparationModes",
      "saveAbilities",
      "skillIds",
      "spellSchools",
      "statusEffects",
      "targetEffects",
      "throwTypes",
      "weaponProperties"
    ].includes(data.id)) {
      data.value = formData[`filters.${data.id}`];
    } else if (data.id === "remainingSpellSlots") {
      data.value = {min: formData[`filters.${data.id}.min`], max: formData[`filters.${data.id}.max`]};
    } else if ([
      "attackTypes",
      "itemTypes",
      "spellLevels"
    ].includes(data.id)) {
      const fd = formData[`filters.${data.id}`];
      for (const a of data.array) if (fd.includes(a.value)) a.checked = true;
    } else if (data.id === "itemRequirements") {
      data.array = {
        equipped: formData[`filters.${data.id}.equipped`],
        attuned: formData[`filters.${data.id}.attuned`]
      };
    } else if (data.id === "spellComponents") {
      for (const a of data.array) a.checked = formData[`filters.${data.id}.types`].includes(a.value);
      data.selected = formData[`filters.${data.id}.match`];
    } else if (data.id === "tokenSizes") {
      data.self = formData["filters.tokenSizes.self"];
      data.type = formData["filters.tokenSizes.type"];
      data.size = formData["filters.tokenSizes.size"];
    } else if (data.id === "healthPercentages") {
      data.value = formData["filters.healthPercentages.value"];
      data.type = formData["filters.healthPercentages.type"];
    }
  }

  /**
   * Whether this item is one that can be equipped.
   * @param {Item5e} item     The item being viewed.
   * @returns {boolean}       Whether it can be equipped.
   */
  _canEquipItem(item) {
    return (item instanceof Item) && EQUIPPABLE_TYPES.includes(item.type);
  }

  /**
   * Whether this item has been set as attuned or attunement required.
   * @param {Item5e} item     The item being viewed.
   * @returns {boolean}       Whether it is or can be attuned to.
   */
  _canAttuneToItem(item) {
    const {REQUIRED, ATTUNED} = CONFIG.DND5E.attunementTypes;
    return (item instanceof Item) && [REQUIRED, ATTUNED].includes(item.system.attunement);
  }

  /**
   * Returns whether a filter is available to be added to babonus, given the current filters
   * in use, the type of document it belongs to, as well as the type of babonus.
   * @param {string} id     The id of the filter.
   * @returns {boolean}     Whether the filter can be added.
   */
  _isFilterAvailable(id) {
    if (id === "arbitraryComparison") return true;
    if (this._addedFilters.has(id)) return false;

    const type = this._type ?? this._bab.type;

    switch (id) {
      case "abilities": return ["attack", "damage", "save", "test"].includes(type);
      case "attackTypes": return ["attack", "damage"].includes(type);
      case "baseArmors": return true;
      case "baseTools": return ["test"].includes(type);
      case "baseWeapons": return this._itemTypes.has("weapon");
      case "creatureTypes": return true;
      case "customScripts": return true;
      case "damageTypes": return ["attack", "damage", "save"].includes(type);
      case "healthPercentages": return true;
      case "itemRequirements": return this._canEquipItem(this.object) || this._canAttuneToItem(this.object);
      case "itemTypes": return ["attack", "damage", "save"].includes(type);
      case "preparationModes": return this._itemTypes.has("spell");
      case "remainingSpellSlots": return true;
      case "saveAbilities": return ["save"].includes(type);
      case "skillIds": return ["test"].includes(type);
      case "spellComponents": return this._itemTypes.has("spell");
      case "spellLevels": return this._itemTypes.has("spell");
      case "spellSchools": return this._itemTypes.has("spell");
      case "statusEffects": return true;
      case "targetEffects": return true;
      case "throwTypes": return ["throw"].includes(type);
      case "tokenSizes": return true;
      case "weaponProperties": return this._itemTypes.has("weapon");
    }
  }

  /**
   * ----------------------------------------------------
   *
   *
   *                   STATIC FUNCTIONS
   *
   *
   * ----------------------------------------------------
   */

  /**
   * Gather a collection of babonuses from a document.
   * @param {Document5e} object         An actor, item, effect, or template.
   * @returns {Collection<Babonus>}     A collection of babonuses.
   */
  static _getCollection(object) {
    const bonuses = Object.entries(object.flags[MODULE]?.bonuses ?? {});
    const contents = bonuses.reduce((acc, [id, data]) => {
      if (!foundry.data.validators.isValidId(id)) return acc;
      try {
        const bonus = this._createBabonus(data, id, {parent: object});
        acc.push([id, bonus]);
      } catch (err) {
        console.warn(err);
      }
      return acc;
    }, []);
    return new foundry.utils.Collection(contents);
  }

  /**
   * Create a Babonus with the given id (or a new one if none is provided).
   * @param {object} data             An object of babonus data.
   * @param {string} id               Optionally an id to assign the babonus.
   * @param {object} [options={}]     Additional options that modify the babonus creation.
   * @returns {Babonus}               The created babonus.
   */
  static _createBabonus(data, id, options = {}) {
    const types = TYPES.map(t => t.value);
    if (!types.includes(data.type)) {
      throw new Error("INVALID BABONUS TYPE.");
    }

    // if no id explicitly provided, make a new one.
    data.id = id ?? foundry.utils.randomID();

    const bonus = new {
      attack: AttackBabonus,
      damage: DamageBabonus,
      save: SaveBabonus,
      test: TestBabonus,
      throw: ThrowBabonus,
      hitdie: HitDieBabonus
    }[data.type](data, options);
    return bonus;
  }
}
