function setup_e_waybill_actions(doctype) {
    frappe.ui.form.on(doctype, {
        setup(frm) {
            frappe.realtime.on("e_waybill_pdf_attached", () => {
                frm.reload_doc();
                frappe.show_alert({
                    indicator: "green",
                    message: __("e-Waybill PDF attached successfully"),
                });
            });
        },
        refresh(frm) {
            let settings = frappe.boot.gst_settings;
            if (
                frm.doc.docstatus != 1 ||
                !settings.enable_api ||
                !is_e_waybill_applicable(frm) ||
                !frm.doc.company_gstin // means company is Indian and not Unregistered
            )
                return;

            if (
                !frm.doc.ewaybill &&
                frappe.perm.has_perm(frm.doctype, 0, "submit", frm.doc.name)
            ) {
                frm.add_custom_button(
                    __("Generate"),
                    () => show_generate_e_waybill_dialog(frm),
                    "e-Waybill"
                );
            }

            if (!frm.doc.ewaybill) return;

            if (
                frappe.perm.has_perm(frm.doctype, 0, "submit", frm.doc.name) &&
                is_e_waybill_valid(frm)
            ) {
                frm.add_custom_button(
                    __("Update Vehicle Info"),
                    () => show_update_vehicle_info_dialog(frm),
                    "e-Waybill"
                );

                frm.add_custom_button(
                    __("Update Transporter"),
                    () => show_update_transporter_dialog(frm),
                    "e-Waybill"
                );
            }

            if (
                frappe.perm.has_perm(frm.doctype, 0, "cancel", frm.doc.name) &&
                is_e_waybill_cancellable(frm)
            ) {
                frm.add_custom_button(
                    __("Cancel"),
                    () => show_cancel_e_waybill_dialog(frm),
                    "e-Waybill"
                );
            }

            if (frappe.perm.has_perm(frm.doctype, 0, "print", frm.doc.name)) {
                frm.add_custom_button(
                    __("Print"),
                    () =>
                        fetch_e_waybill_data(frm, null, function (response) {
                            if (!response.message) return;

                            if (action == "print") {
                                frappe.set_route(
                                    "print",
                                    "e-waybill-log",
                                    frm.doc.ewaybill
                                );
                                return;
                            }
                        }),
                    "e-Waybill"
                );
            }

            if (frappe.perm.has_perm(frm.doctype, 0, "attach", frm.doc.name)) {
                frm.add_custom_button(
                    __("Attach"),
                    () => fetch_e_waybill_data(frm, { attach: 1 }, () => frm.refresh()),
                    "e-Waybill"
                );
            }
        },
        on_submit(frm) {
            if (
                frm.doc.ewaybill ||
                frm.doc.is_return ||
                !gst_settings.enable_api ||
                !gst_settings.auto_generate_e_waybill ||
                (gst_settings.enable_e_invoice &&
                    gst_settings.auto_generate_e_invoice) ||
                !is_e_waybill_applicable(frm)
            )
                return;

            frappe.show_alert(__("Attempting to generate e-Waybill"));

            frappe.call({
                method: "india_compliance.gst_india.utils.e_waybill.generate_e_waybill",
                args: { docname: frm.doc.name },
                callback: () => frm.refresh(),
            });
        },
    });
}
function fetch_e_waybill_data(frm, args, callback) {
    if (!args) args = {};

    frappe.call({
        method: "india_compliance.gst_india.utils.e_waybill.fetch_e_waybill_data",
        args: { docname: frm.doc.name, ...args },
        callback,
    });
}

function show_generate_e_waybill_dialog(frm) {
    const d = new frappe.ui.Dialog({
        title: __("Generate e-Waybill"),
        fields: [
            {
                label: "Transporter",
                fieldname: "transporter",
                fieldtype: "Link",
                options: "Supplier",
                default: frm.doc.transporter,
                get_query: () => {
                    return {
                        filters: {
                            is_transporter: 1,
                        },
                    };
                },
                onchange: () => update_gst_tranporter_id(d),
            },
            {
                label: "GST Transporter ID",
                fieldname: "gst_transporter_id",
                fieldtype: "Data",
                fetch_from: "transporter.gst_transporter_id",
                default:
                    frm.doc.gst_transporter_id &&
                    frm.doc.gst_transporter_id.length == 15
                        ? frm.doc.gst_transporter_id
                        : "",
            },
            {
                label: "Vehicle No",
                fieldname: "vehicle_no",
                fieldtype: "Data",
                default: frm.doc.vehicle_no,
            },
            {
                label: "Distance (in km)",
                fieldname: "distance",
                fieldtype: "Float",
                default: frm.doc.distance,
            },
            {
                fieldtype: "Column Break",
            },
            {
                label: "Transport Receipt No",
                fieldname: "lr_no",
                fieldtype: "Data",
                default: frm.doc.lr_no,
            },
            {
                label: "Transport Receipt Date",
                fieldname: "lr_date",
                fieldtype: "Date",
                default: frm.doc.lr_date,
            },
            {
                label: "Mode Of Transport",
                fieldname: "mode_of_transport",
                fieldtype: "Select",
                options: `\nRoad\nAir\nRail\nShip`,
                default: frm.doc.mode_of_transport,
            },
            {
                label: "GST Vehicle Type",
                fieldname: "gst_vehicle_type",
                fieldtype: "Select",
                options: `Regular\nOver Dimensional Cargo (ODC)`,
                depends_on: 'eval:(doc.mode_of_transport === "Road")',
                default: frm.doc.gst_vehicle_type,
            },
            {
                fieldtype: "Section Break",
            },
            {
                fieldname: "gst_category",
                label: "GST Category",
                fieldtype: "Select",
                options:
                    "\nRegistered Regular\nRegistered Composition\nUnregistered\nSEZ\nOverseas\nConsumer\nDeemed Export\nUIN Holders",
                fetch_from: "customer_address.gst_category",
                fetch_if_empty: 1,
                default: frm.doc.gst_category,
            },
            {
                fieldtype: "Column Break",
            },
            {
                fieldname: "export_type",
                label: "Export Type",
                fieldtype: "Select",
                depends_on:
                    'eval:in_list(["SEZ", "Overseas", "Deemed Export"], doc.gst_category)',
                options: "\nWith Payment of Tax\nWithout Payment of Tax",
                fetch_from: "customer_address.export_type",
                fetch_if_empty: 1,
                default: frm.doc.export_type,
            },
        ],
        primary_action_label: __("Generate"),
        primary_action(values) {
            frappe.call({
                method: "india_compliance.gst_india.utils.e_waybill.generate_e_waybill",
                args: {
                    docname: frm.doc.name,
                    values,
                },
                callback: () => frm.refresh(),
            });

            d.hide();
        },
    });

    d.show();
}

function show_cancel_e_waybill_dialog(frm, callback) {
    const d = new frappe.ui.Dialog({
        title: __("Cancel e-Waybill"),
        fields: [
            {
                label: "e-Waybill",
                fieldname: "ewaybill",
                fieldtype: "Data",
                read_only: 1,
                default: frm.doc.ewaybill,
            },
            {
                label: "Reason",
                fieldname: "reason",
                fieldtype: "Select",
                reqd: 1,
                default: "Data Entry Mistake",
                options: [
                    "Duplicate",
                    "Order Cancelled",
                    "Data Entry Mistake",
                    "Others",
                ],
            },
            {
                label: "Remark",
                fieldname: "remark",
                fieldtype: "Data",
                mandatory_depends_on: "eval: doc.reason == 'Others'",
            },
        ],
        primary_action_label: __("Cancel"),
        primary_action(values) {
            frappe.call({
                method: "india_compliance.gst_india.utils.e_waybill.cancel_e_waybill",
                args: {
                    docname: frm.doc.name,
                    values,
                },
                callback: () => {
                    frm.refresh();
                    if (callback) callback();
                },
            });
            d.hide();
        },
    });

    d.show();
}

function show_update_vehicle_info_dialog(frm) {
    const d = new frappe.ui.Dialog({
        title: __("Update Vehicle Information"),
        fields: [
            {
                label: "e-Waybill",
                fieldname: "ewaybill",
                fieldtype: "Data",
                read_only: 1,
                default: frm.doc.ewaybill,
            },
            {
                label: "Vehicle No",
                fieldname: "vehicle_no",
                fieldtype: "Data",
                reqd: 1,
                default: frm.doc.vehicle_no,
            },
            {
                label: "Transport Receipt No",
                fieldname: "lr_no",
                fieldtype: "Data",
                default: frm.doc.lr_no,
            },
            {
                fieldtype: "Column Break",
            },
            {
                label: "Mode Of Transport",
                fieldname: "mode_of_transport",
                fieldtype: "Select",
                options: `\nRoad\nAir\nRail\nShip`,
                default: frm.doc.mode_of_transport,
            },
            {
                label: "GST Vehicle Type",
                fieldname: "gst_vehicle_type",
                fieldtype: "Select",
                options: `Regular\nOver Dimensional Cargo (ODC)`,
                depends_on: 'eval:(doc.mode_of_transport === "Road")',
                default: frm.doc.gst_vehicle_type,
            },
            {
                label: "Transport Receipt Date",
                fieldname: "lr_date",
                fieldtype: "Date",
                default: frm.doc.lr_date,
            },
            {
                fieldtype: "Section Break",
            },
            {
                fieldname: "reason",
                label: "Reason",
                fieldtype: "Select",
                options: [
                    "Due to Break Down",
                    "Due to Trans Shipment",
                    "First Time",
                    "Others",
                ],
                reqd: 1,
            },
            {
                label: "Update e-Waybill Print/Data",
                fieldname: "update_e_waybill_data",
                fieldtype: "Check",
                default: frappe.boot.gst_settings.fetch_e_waybill_data,
            },
            {
                fieldtype: "Column Break",
            },
            {
                fieldname: "remark",
                label: "Remark",
                fieldtype: "Data",
                mandatory_depends_on: 'eval: doc.reason == "Others"',
            },
        ],
        primary_action_label: __("Update"),
        primary_action(values) {
            frappe.call({
                method: "india_compliance.gst_india.utils.e_waybill.update_vehicle_info",
                args: {
                    docname: frm.doc.name,
                    values,
                },
                callback: () => frm.refresh(),
            });
            d.hide();
        },
    });

    d.show();
}

function show_update_transporter_dialog(frm) {
    const d = new frappe.ui.Dialog({
        title: __("Update Transporter"),
        fields: [
            {
                label: "e-Waybill",
                fieldname: "ewaybill",
                fieldtype: "Data",
                read_only: 1,
                default: frm.doc.ewaybill,
            },
            {
                label: "Transporter",
                fieldname: "transporter",
                fieldtype: "Link",
                options: "Supplier",
                default: frm.doc.transporter,
                get_query: () => {
                    return {
                        filters: {
                            is_transporter: 1,
                        },
                    };
                },
                onchange: () => update_gst_tranporter_id(d),
            },
            {
                label: "GST Transporter ID",
                fieldname: "gst_transporter_id",
                fieldtype: "Data",
                reqd: 1,
                default:
                    frm.doc.gst_transporter_id &&
                    frm.doc.gst_transporter_id.length == 15
                        ? frm.doc.gst_transporter_id
                        : "",
            },
            {
                label: "Update e-Waybill Print/Data",
                fieldname: "update_e_waybill_data",
                fieldtype: "Check",
                default: frappe.boot.gst_settings.fetch_e_waybill_data,
            },
        ],
        primary_action_label: __("Update"),
        primary_action(values) {
            frappe.call({
                method: "india_compliance.gst_india.utils.e_waybill.update_transporter",
                args: {
                    docname: frm.doc.name,
                    values,
                },
                callback: () => frm.refresh(),
            });
            d.hide();
        },
    });

    d.show();
}

async function update_gst_tranporter_id(d) {
    const transporter = d.fields_dict.transporter.value;
    const { message: response } = await frappe.db.get_value(
        "Supplier",
        transporter,
        "gst_transporter_id"
    );

    d.set_value("gst_transporter_id", response.gst_transporter_id);
}

function is_e_waybill_valid(frm) {
    const e_waybill_info = frm.doc.__onload && frm.doc.__onload.e_waybill_info;
    return (
        e_waybill_info &&
        (!e_waybill_info.valid_upto ||
            ic.get_moment(e_waybill_info.valid_upto).diff() > 0)
    );
}

function is_e_waybill_applicable(frm) {
    if (
        Math.abs(frm.doc.base_grand_total) <
        frappe.boot.gst_settings.e_waybill_threshold
    )
        return;

    for (let item of frm.doc.items) {
        if (!item.gst_hsn_code.startsWith("99")) return true;
    }
}

function is_e_waybill_cancellable(frm) {
    const e_waybill_info = frm.doc.__onload && frm.doc.__onload.e_waybill_info;
    return (
        ewaybill_info &&
        ic.get_moment(e_waybill_info.created_on).add("days", 1).diff() > 0
    );
}
