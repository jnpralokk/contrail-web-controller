/*
 * Copyright (c) 2014 Juniper Networks, Inc. All rights reserved.
 */

/**
 * @portsconfig.api.js
 *     - Handlers for Port Configuration
 *     - Interfaces with config api server
 */

//var rest = require(process.mainModule.exports["corePath"] + '/src/serverroot/common/rest.api');
var async = require('async');
var logutils = require(process.mainModule.exports["corePath"] +
                       '/src/serverroot/utils/log.utils');
var commonUtils = require(process.mainModule.exports["corePath"] +
                          '/src/serverroot/utils/common.utils');
//var config = require(process.mainModule.exports["corePath"] + '/config/config.global.js');

var messages = require(process.mainModule.exports["corePath"] + '/src/serverroot/common/messages');
var global = require(process.mainModule.exports["corePath"] + '/src/serverroot/common/global');
var appErrors = require(process.mainModule.exports["corePath"] +
                        '/src/serverroot/errors/app.errors');
var computeApi = require(process.mainModule.exports["corePath"] +
                         '/src/serverroot/common/computemanager.api');
var util = require('util');
var url = require('url');
var UUID = require('uuid-js');
var configApiServer = require(process.mainModule.exports["corePath"] +
                              '/src/serverroot/common/configServer.api');


/**
 * Bail out if called directly as "nodejs portsconfig.api.js"
 */
if (!module.parent)
{
    logutils.logger.warn(util.format(messages.warn.invalid_mod_call,
        module.filename));
    process.exit(1);
}

/**
 * @readPorts
 * Pubilc function
 * URL :/api/admin/config/get-data?type=ports&count=
 * 1. Pagination function to read each port
 * 2. Read the list of ports
 */

function readPorts (portsObj, callback)
{
    var dataObjArr = portsObj['reqDataArr'];
    async.map(dataObjArr, getPortsAsync, function(err, data) {
        callback(err, data);
    });
}

/**
 * @getPortsAsync
 * private function
 * 1. Callback for readPorts
 * 2. Reads the response of per vmi's list from config api server
 *    and sends it back to the client.
 */
function getPortsAsync (portsObj, callback)
{
    var portId = portsObj['uuid'];
    var appData = portsObj['appData'];
    var reqUrl = '/virtual-machine-interface/' + portId;
    configApiServer.apiGet(reqUrl, appData, function(err, data) {
        getVirtualMachineInterfaceCb(err, data, appData, callback);
    });
}

/**
 * @getVirtualMachineInterfaceCb
 * private function
 * 1. Called from getPortsAsync
 * 2. Create the data object for all reference link
 *    like Floating object, Instance Ip, Rout table and
 *    the mergeVMIResponse is called for formating the result object.
 * 3. The result is sent back to getPortsAsync.
 */
function getVirtualMachineInterfaceCb (err, vmiData, appData, callback)
{
    var dataObjArr            = [];
    var floatingipPoolRefsLen = 0;
    var fixedipPoolRefsLen    = 0;
    var routeTableRefsLen     = 0;
    var floatingipPoolRef     = null;
    var fixedipPoolRef        = null;
    var routeTableRef         = null;
    var floatingipObj         = null;
    var fixedipObj            = null;
    var routeTableObj         = null;

    if ('floating_ip_back_refs' in vmiData['virtual-machine-interface']) {
        floatingipPoolRef = vmiData['virtual-machine-interface']['floating_ip_back_refs'];
        floatingipPoolRefsLen = floatingipPoolRef.length;
    }
    for (i = 0; i < floatingipPoolRefsLen; i++) {
        floatingipObj = floatingipPoolRef[i];
        reqUrl = '/floating-ip/' + floatingipObj['uuid'];
        commonUtils.createReqObj(dataObjArr, reqUrl,
                                 global.HTTP_REQUEST_GET, null, null, null,
                                 appData);
    }
    if ('instance_ip_back_refs' in vmiData['virtual-machine-interface']) {
        fixedipPoolRef = vmiData['virtual-machine-interface']['instance_ip_back_refs'];
        fixedipPoolRefsLen = fixedipPoolRef.length;
    }
    for (i = 0; i < fixedipPoolRefsLen; i++) {
        fixedipObj = fixedipPoolRef[i];
        reqUrl = '/instance-ip/' + fixedipObj['uuid'];
        commonUtils.createReqObj(dataObjArr, reqUrl,
                                 global.HTTP_REQUEST_GET, null, null, null,
                                 appData);
    }
    if ('interface_route_table_refs' in vmiData['virtual-machine-interface']) {
        routeTableRef = vmiData['virtual-machine-interface']['interface_route_table_refs'];
        routeTableRefsLen = routeTableRef.length;
    }

    for (i = 0; i < routeTableRefsLen; i++) {
        routeTableObj = routeTableRef[i];
        reqUrl = '/interface-route-table/' + routeTableObj['uuid'];
        commonUtils.createReqObj(dataObjArr, reqUrl,
                                 global.HTTP_REQUEST_GET, null, null, null,
                                 appData);
    }

    if (!dataObjArr.length) {
        callback(err,vmiData);
        return;
    }

    async.map(dataObjArr,
    commonUtils.getAPIServerResponse(configApiServer.apiGet, true),
    function(error, results) {
        if (error) {
            callback(error, vmiData);
            return;
        }
        mergeVMIResponse(results, vmiData,
                     floatingipPoolRefsLen, routeTableRefsLen,
                     appData, function(vmiData){
                         callback(error, vmiData);
                    });
    });
}

/**
 * @mergeVMIResponse
 * private function
 * 1. called from getVirtualMachineInterfaceCb
 * 2. Result object will be merged with the VMI object
 * 3. The result is sent back to getVirtualMachineInterfaceCb.
 */
function mergeVMIResponse (results, vmiData, floatingipPoolRefsLen, routeTableRefsLen, appData, callback)
{
    var i = 0;
    var ipPoolsLen = results.length;
    var instanceIPLen = ipPoolsLen - routeTableRefsLen;

    for (i = 0; i < floatingipPoolRefsLen; i++) {
        if (results[i] != null) {
            vmiData['virtual-machine-interface']['floating_ip_back_refs'][i]['floatingip'] = {};
            vmiData['virtual-machine-interface']['floating_ip_back_refs'][i]['floatingip'].ip =
                     results[i]['floating-ip']['floating_ip_address'];
            vmiData['virtual-machine-interface']['floating_ip_back_refs'][i]['floatingip'].subnet_uuid =
                     results[i]['floating-ip']['subnet_uuid'];
        }
    }

    for (i = floatingipPoolRefsLen; i < instanceIPLen; i++) {
        if (results[i]) {
            vmiData['virtual-machine-interface']['instance_ip_back_refs'][i - floatingipPoolRefsLen]['fixedip'] = {};
            vmiData['virtual-machine-interface']['instance_ip_back_refs'][i - floatingipPoolRefsLen]['fixedip'].ip =
                     results[i]['instance-ip']['instance_ip_address'];
        }
    }
    for (i = instanceIPLen; i < ipPoolsLen; i++) {
        if (results[i]) {
            vmiData['virtual-machine-interface']['interface_route_table_refs'][i - instanceIPLen]['sharedip'] =
                     results[i]['interface-route-table']['interface_route_table_routes'];
        }
    }
    callback(vmiData);
}

 /**
 * @createPortCB
 * public function
 * 1. Creating port VMI
 * 2. Sets Post Data and sends back to the called function
 */
function createPortCB (dataObj, callback)
{
    var req = dataObj.request;
    var response = dataObj.response;
    var appData = dataObj.appData;
    var data = dataObj.vmidata;

    createPortValidate(req, data, response, appData, function(error, results) {
        callback(error, results);
    }) ;
}

/**
 * @createPort
 * public function
 * 1. URL /api/tenants/config/ports Post
 * 2. Set Post Data and sends back the port Detail(VMI) to client
 */
function createPort (request, response, appData)
{
    createPortValidate(request, request.body, response, appData, function(error, results) {
        commonUtils.handleJSONResponse(error, response, results);
    }) ;
}

/**
 * @createPortValidate
 * private function
 * 1. Basic validation before creating the port(VMI)
 */
function createPortValidate (request, data, response, appData, callback)
{
    var portsCreateURL = '/virtual-machine-interfaces';
    var portPostData = data;
    var orginalPortData = commonUtils.cloneObj(data);

    if (typeof(portPostData) != 'object') {
        error = new appErrors.RESTServerError('Invalid Post Data');
        callback(error, null);
        return;
    }

    if ((!('virtual-machine-interface' in portPostData)) ||
        (!('fq_name' in portPostData['virtual-machine-interface']))) {
        error = new appErrors.RESTServerError('Enter Port Name ');
        callback(error, null);
        return;
    }

    if (portPostData['virtual-machine-interface']['fq_name'].length == 2) {
        var uuid = UUID.create();
        portPostData["virtual-machine-interface"]["uuid"] = uuid['hex'];
        portPostData["virtual-machine-interface"]["fq_name"][2] = uuid['hex'];
        portPostData["virtual-machine-interface"]["display_name"] = uuid['hex'];
        portPostData["virtual-machine-interface"]["name"] = uuid['hex'];
    }

    if ('instance_ip_back_refs' in portPostData['virtual-machine-interface']) {
        delete portPostData['virtual-machine-interface']['instance_ip_back_refs'];
    }
    if ('interface_route_table_refs' in portPostData['virtual-machine-interface']) {
        delete portPostData['virtual-machine-interface']['interface_route_table_refs'];
    }
    var lrUUID = "";
    if ('logical_router_back_refs' in portPostData['virtual-machine-interface']) {
        if (portPostData['virtual-machine-interface']['logical_router_back_refs'].length === 1) {
            lrUUID = portPostData['virtual-machine-interface']['logical_router_back_refs'][0]['uuid'];
        }
        delete portPostData['virtual-machine-interface']['logical_router_back_refs'];
    }
    if (('virtual_machine_interface_device_owner' in portPostData['virtual-machine-interface']) &&
        portPostData['virtual-machine-interface']["virtual_machine_interface_device_owner"] == "compute:nova") {
        portPostData["virtual-machine-interface"]["virtual_machine_interface_device_owner"] = "";
    }

    configApiServer.apiPost(portsCreateURL, portPostData, appData,
                            function(error, vmisData) {
        if (error) {
            callback(error, null);
            return;
        }
        var portId = vmisData['virtual-machine-interface']['uuid'];
        readVMIwithUUID(portId, appData, function(err, vmiData){
            if (err) {
                callback(err, vmiData);
                return;
            }
            readLogicalRouter(lrUUID, appData, function(err, apiLogicalRouterData){
                if (err) {
                    callback(err, apiLogicalRouterData);
                    return;
                }
                portSendResponse(error, request, vmiData, orginalPortData, apiLogicalRouterData, appData, function(err, results) {
                    callback(err, results);
                    return;
                });
            });
        });
    });
}

/**
 * @createFixedIPDataObject
 * private function
 * 1. Callback for Ports create / update operations
 * 2. Set the VMI reference in fixed IP object
      and return back to create the seperate Instance Ip.
 */
function createFixedIPDataObject (response,portConfig, fixedip)
{
    if (fixedip != null && fixedip != "") {
        var fixedIpObj = {};
        fixedIpObj["instance-ip"] = {};
        uuid = UUID.create();
        fixedIpObj["instance-ip"]["fq_name"] = [];
        fixedIpObj["instance-ip"]["fq_name"][0] = uuid['hex'];
        fixedIpObj["instance-ip"]["display_name"] = uuid['hex'];
        fixedIpObj["instance-ip"]["name"] = uuid['hex'];
        fixedIpObj["instance-ip"]["uuid"] = uuid['hex'];
        if ('fixedIp' in fixedip['instance_ip_address'][0]) {
            fixedIpObj["instance-ip"]["instance_ip_address"] = fixedip['instance_ip_address'][0]["fixedIp"];
        }
        fixedIpObj["instance-ip"]["subnet_uuid"] = fixedip["subnet_uuid"];
        fixedIpObj["instance-ip"]["virtual_machine_interface_refs"] = [];
        fixedIpObj["instance-ip"]["virtual_machine_interface_refs"][0] = {};
        fixedIpObj["instance-ip"]["virtual_machine_interface_refs"][0]["to"] = portConfig['virtual-machine-interface']["fq_name"];
        fixedIpObj["instance-ip"]["virtual_machine_interface_refs"][0]["uuid"] = portConfig['virtual-machine-interface']['uuid'];
        if ('virtual_network_refs' in portConfig['virtual-machine-interface']) {
        fixedIpObj["instance-ip"]["virtual_network_refs"] = [];
        fixedIpObj["instance-ip"]["virtual_network_refs"] = portConfig['virtual-machine-interface']['virtual_network_refs'];
        }
        response = fixedIpObj;
    }
    return response;
}

/**
 * @createlogicalRouterDataObject
 * private function
 * 1. Callback for Ports create / update operations
 * 2. Set the VMI reference in Logical router object
      and return back to create the seperate Logigal router.
 */
function createlogicalRouterDataObject (response,portConfig,apiLogicalRouterObj)
{
    var logicalrouter = {};
    if ('virtual_machine_interface_refs' in apiLogicalRouterObj['logical-router']) {
        if (apiLogicalRouterObj['logical-router']['virtual_machine_interface_refs'].length > 0) {
            var vmiref_len = apiLogicalRouterObj['logical-router']['virtual_machine_interface_refs'].length;
            var vmiExists = false;
            for (var i = 0; i < vmiref_len; i++) {
                if (portConfig['virtual-machine-interface']['uuid'] ===
                    apiLogicalRouterObj['logical-router']['virtual_machine_interface_refs']['uuid']) {
                    vmiExists = true;
                    break;
                }
            }
            if (vmiExists === false) {
                var vmi = {};
                vmi.to = portConfig['virtual-machine-interface']["fq_name"];
                vmi.uuid = portConfig['virtual-machine-interface']["uuid"];
                vmi.attr = null;
                apiLogicalRouterObj['logical-router']['virtual_machine_interface_refs'][vmiref_len] = vmi;
                logicalrouter["logical-router"] = {};
                logicalrouter["logical-router"]["fq_name"] = apiLogicalRouterObj["logical-router"]['fq_name'];
                logicalrouter["logical-router"]['uuid'] = apiLogicalRouterObj["logical-router"]['uuid'];
                logicalrouter['logical-router']['virtual_machine_interface_refs']=apiLogicalRouterObj['logical-router']['virtual_machine_interface_refs'];
            }
        } else {
            logicalrouter["logical-router"] = {};
            logicalrouter["logical-router"]["virtual_machine_interface_refs"] = [];
            logicalrouter["logical-router"]["virtual_machine_interface_refs"][0] = {};
            logicalrouter["logical-router"]["virtual_machine_interface_refs"][0]["to"] = portConfig['virtual-machine-interface']["fq_name"];
            logicalrouter["logical-router"]["virtual_machine_interface_refs"][0]["uuid"] = portConfig['virtual-machine-interface']['uuid'];
        }
    } else {
        logicalrouter["logical-router"] = {};
        logicalrouter["logical-router"]["virtual_machine_interface_refs"] = [];
        logicalrouter["logical-router"]["virtual_machine_interface_refs"][0] = {};
        logicalrouter["logical-router"]["virtual_machine_interface_refs"][0]["to"] = portConfig['virtual-machine-interface']["fq_name"];
        logicalrouter["logical-router"]["virtual_machine_interface_refs"][0]["uuid"] = portConfig['virtual-machine-interface']['uuid'];
    }
    response = logicalrouter;
    return response;
}


/**
 * @createStaticIPDataObject
 * private function
 * 1. Callback for Ports create / update operations
 * 2. Set the VMI reference in Static IP object
 *    and return back to create the seperate Static IP.
 */
function createStaticIPDataObject (response, portConfig, sharedip, uuid)
{
    if (sharedip != null && sharedip != "" && 'route' in sharedip && sharedip.route.length > 0) {
        var sharedIpObj = {};
        sharedIpObj["interface-route-table"] = {};
        if (uuid == null || uuid == "" || uuid == undefined) {
            uuid = UUID.create();
            uuid = uuid['hex']
        }
        sharedIpObj["interface-route-table"]["fq_name"] = [];
        sharedIpObj["interface-route-table"]["fq_name"][0] = portConfig['virtual-machine-interface']["fq_name"][0];
        sharedIpObj["interface-route-table"]["fq_name"][1] = portConfig['virtual-machine-interface']["fq_name"][1];
        sharedIpObj["interface-route-table"]["fq_name"][2] = uuid;
        sharedIpObj["interface-route-table"]["display_name"] = uuid;
        sharedIpObj["interface-route-table"]["name"] = uuid;
        sharedIpObj["interface-route-table"]["uuid"] = uuid;
        sharedIpObj["interface-route-table"]["parent_type"] = "project";
        sharedIpObj["interface-route-table"]["interface_route_table_routes"] = {};
        sharedIpObj["interface-route-table"]["interface_route_table_routes"]["route"] = [];
        sharedIpObj["interface-route-table"]["interface_route_table_routes"]["route"] = sharedip.route;
        response = sharedIpObj;
    }
    return response;
}


/**
 * @createFloatingIPDataObject
 * private function
 * 1. Callback for Ports create / update operations
 * 2. Set the VMI reference in Floating IP object
 *    and return back to update the Floating IP.
 */
function createFloatingIPDataObject (response,portConfig, fqname)
{
    if (fqname != null && fqname != "") {
        var floatingIp = {};
        floatingIp["floating-ip"] = {};
        floatingIp["floating-ip"]["fq_name"] = [];
        floatingIp["floating-ip"]["fq_name"][0] = fqname['to'];
        floatingIp["floating-ip"]["fq_name"]['uuid'] = fqname['uuid'];
        floatingIp["floating-ip"]["virtual_machine_interface_refs"] = [];
        floatingIp["floating-ip"]["virtual_machine_interface_refs"][0] = {};
        floatingIp["floating-ip"]["virtual_machine_interface_refs"][0]["to"] = portConfig['virtual-machine-interface']["fq_name"];
        floatingIp["floating-ip"]["virtual_machine_interface_refs"][0]["uuid"] = portConfig['virtual-machine-interface']['uuid'];
        response = floatingIp;
    }
    return response;
}


/**
 * @portSendResponse
 * private function
 * 1. Callback for Ports create operations
 * 2. Create/Read the seperate data object for
 *    Floating IP, Logical Router, Fixed IP.
 */
function portSendResponse (error, req, portConfig, orginalPortData, apiLogicalRouterData, appData, callback)
{
    if (error) {
        callback(error, null);
        return;
    }
    var fixedIpPoolRef = null;
    var fixedIpPoolRefLen = 0;
    var DataObjectArr = [];
    if (('instance_ip_back_refs' in orginalPortData['virtual-machine-interface']) &&
       (orginalPortData['virtual-machine-interface']['instance_ip_back_refs'].length > 0)) {
        fixedIpPoolRef = orginalPortData['virtual-machine-interface']['instance_ip_back_refs'];
        if (fixedIpPoolRef != null && fixedIpPoolRef != "") {
            fixedIpPoolRefLen = fixedIpPoolRef.length;
        }
    }

    if (fixedIpPoolRefLen > 0) {
        var instanceCreateURL = '/instance-ips';
        for (var i = 0; i < fixedIpPoolRefLen; i++) {
            var responceData = {};
            responceData = createFixedIPDataObject(responceData,portConfig,fixedIpPoolRef[i]);
            commonUtils.createReqObj(DataObjectArr, instanceCreateURL,
                                     global.HTTP_REQUEST_POST,
                                     commonUtils.cloneObj(responceData), null, null,
                                     appData);
        }
    }


    var staticIpPoolRef = null;
    var staticIpPoolRefLen = 0;
    if (('interface_route_table_refs' in orginalPortData['virtual-machine-interface']) &&
       (orginalPortData['virtual-machine-interface']['interface_route_table_refs'].length > 0)) {
        staticIpPoolRef = orginalPortData['virtual-machine-interface']['interface_route_table_refs'];
        staticIpPoolRefLen = staticIpPoolRef.length;
    }

    if (staticIpPoolRef != null && staticIpPoolRef != "") {
        if (staticIpPoolRefLen > 0) {
            var staticIpCreateURL = '/interface-route-tables';
            var responceData = {};
            responceData = createStaticIPDataObject(responceData,portConfig,staticIpPoolRef[0]["sharedip"]);
            commonUtils.createReqObj(DataObjectArr, staticIpCreateURL,
                             global.HTTP_REQUEST_POST,
                             commonUtils.cloneObj(responceData), null, null,
                             appData);
        }
    }

    var logicalRouter = null;
    var logicalRouterLen = 0;
    if (('logical_router_back_refs' in orginalPortData['virtual-machine-interface']) &&
       (orginalPortData['virtual-machine-interface']['logical_router_back_refs'].length > 0)) {
        logicalRouter = orginalPortData['virtual-machine-interface']['logical_router_back_refs'];
        if (logicalRouter != null && logicalRouter != "")
            logicalRouterLen = logicalRouter.length;
    }


    if (logicalRouterLen === 1) {
        logicalRouter = logicalRouter[0];
            var logicalRouterURL = '/logical-router/'+logicalRouter['uuid'];
            var responceData = {};
            responceData = createlogicalRouterDataObject(responceData,portConfig,apiLogicalRouterData);
            commonUtils.createReqObj(DataObjectArr, logicalRouterURL,
                         global.HTTP_REQUEST_PUT, commonUtils.cloneObj(responceData), null, null,
                        appData);
    }

    var floatingipPoolRef = null;
    var floatingipPoolRefLen = 0;

    if ('floating_ip_back_refs' in orginalPortData['virtual-machine-interface']) {
        floatingipPoolRef = orginalPortData['virtual-machine-interface']['floating_ip_back_refs'];
        floatingipPoolRefLen = floatingipPoolRef.length;
    }
    if (floatingipPoolRef != null && floatingipPoolRef != "") {
        if (floatingipPoolRefLen > 0) {
            for (var i = 0; i < floatingipPoolRefLen; i++) {
                var floatingIPURL = '/floating-ip/'+floatingipPoolRef[i]['uuid'];
                responceData = {};
                responceData = createFloatingIPDataObject(responceData,portConfig,floatingipPoolRef[i]);
                commonUtils.createReqObj(DataObjectArr, floatingIPURL,
                             global.HTTP_REQUEST_PUT, commonUtils.cloneObj(responceData), null, null,
                             appData);
            }
        }
    }

    if ("virtual_machine_interface_device_owner" in orginalPortData["virtual-machine-interface"] &&
       orginalPortData["virtual-machine-interface"]["virtual_machine_interface_device_owner"] == "compute:nova") {
        portConfig["virtual-machine-interface"]["virtual_machine_interface_device_owner"] = "compute:nova";
        body = {};
        body.portID = portConfig["virtual-machine-interface"]["uuid"];
        body.netID = portConfig["virtual-machine-interface"]["virtual_network_refs"][0]["uuid"];
        body.vmUUID = orginalPortData["virtual-machine-interface"]["virtual_machine_refs"][0]["to"][0];
        attachVMICompute(req, body, function(error, results){
            if (error) {
                callback(error, result)
                return;
            }
        });
    }
    if (DataObjectArr.length === 0) {
        callback(error, portConfig)
        return;
    }
    async.map(DataObjectArr,
        commonUtils.getServerResponseByRestApi(configApiServer, true),
        function(error, results) {
            var DataObjectArrUpdate = [];
            if (staticIpPoolRefLen <= 0) {
                callback(error, portConfig);
                return;
            } else if (staticIpPoolRefLen > 0) {
                portConfig["virtual-machine-interface"]["interface_route_table_refs"] = [];
                for (var i = fixedIpPoolRefLen; i < (fixedIpPoolRefLen+staticIpPoolRefLen); i++) {
                    portConfig["virtual-machine-interface"]["interface_route_table_refs"][i-fixedIpPoolRefLen] = {}
                    portConfig["virtual-machine-interface"]["interface_route_table_refs"][i-fixedIpPoolRefLen]["to"] = results[i]["interface-route-table"]["fq_name"];
                    portConfig["virtual-machine-interface"]["interface_route_table_refs"][i-fixedIpPoolRefLen]["uuid"] = results[i]["interface-route-table"]["uuid"];
                }

                var portPutURL = '/virtual-machine-interface/'+portConfig['virtual-machine-interface']['uuid'];
                commonUtils.createReqObj(DataObjectArrUpdate, portPutURL,
                         global.HTTP_REQUEST_PUT, portConfig, null, null,
                         appData);

                if (DataObjectArrUpdate.length > 0) {
                    async.map(DataObjectArrUpdate,
                        commonUtils.getServerResponseByRestApi(configApiServer, true),
                        function(error, results) {
                             callback(error, portConfig);
                             return;
                        });
                } else {
                    callback(error, portConfig);
                    return;
                }
            }
    });

}

/**
 * @updatePortsCB
 * public callback function
 * 1. Update the ports from config api server
 * 2. Return back the result to the called function.
 */
function updatePortsCB (request, appData, callback)
{
    var portId = "";
    portId = request.param('uuid');
    var portPutData = request.body;
    readVMIwithUUID(portId, appData, function(err , vmiData){
        compareUpdateVMI(err, request, portPutData, vmiData, appData, function(error, protUpdateConfig) {
            if (error) {
                callback(error, null);
            } else {
                callback(error, protUpdateConfig);
            }
            return;
        });
    });
}

/**
 * @updatePorts
 * public function
 * 1. URL /api/tenants/config/ports/:id
 * 2. Update the ports from config api server
 * 3. Return back the result to http.
 */
function updatePorts (request, response, appData)
{
    var portId = "";
    portId = request.param('uuid');
    var portPutData = request.body;

    readVMIwithUUID(portId, appData, function(err , vmiData){
        compareUpdateVMI(err, request, portPutData, vmiData, appData, function(error, protUpdateConfig) {
            if (error) {
                commonUtils.handleJSONResponse(error, response, null);
            } else {
                commonUtils.handleJSONResponse(error, response, protUpdateConfig);
            }
            return;
        });
    });
}

/**
 * @attachVMICompute
 * private function
 * 1. Callback for Ports create or update operations
 * 2. call the api to attach the VN object to VMI
 */
function attachVMICompute (req, body, callback)
{
    computeApi.portAttach(req, body, function(err, data) {
        callback(err, data);
        return;
    });
}

/**
 * @detachVMICompute
 * private function
 * 1. Callback for Ports create or update operations
 * 2. call the api to detach the VN object to VMI
 */
function detachVMICompute (req, body, callback)
{
    computeApi.portDetach(req,  body.portID, body.vmUUID, function(err, data) {
        callback(err, data);
        return;
    });
}

/**
 * @compareUpdateVMI
 * private function
 * 1. Callback for Ports update operations
 * 2. Compare the data from UI and data from server is compared and
 *    corresponding read/create/update data object is created.
 */

function compareUpdateVMI (error, request, portPutData, vmiData, appData, callback)
{
    if (error) {
        callback(error, null);
        return;
    }
    var vmiUUID = vmiData['virtual-machine-interface']['uuid'];
    portPutData["virtual-machine-interface"]["id_perms"]["uuid"] = vmiData['virtual-machine-interface']["id_perms"]["uuid"];

    var DataObjectLenDetail = [];
    var DataObjectArr = [];
    var DataObjectDelArr = [];
    var creatFloatingIpLen = 0;
    var deleteFloatingIpLen = 0;

    if ("floating_ip_back_refs" in portPutData["virtual-machine-interface"] ||
        "floating_ip_back_refs" in vmiData["virtual-machine-interface"]) {
        filterUpdateFloatingIP(error, portPutData, vmiData, function(createFloatingIp,deleteFloatingip){
            //createFloatingIP();
            if (createFloatingIp != null && createFloatingIp != "") {
                creatFloatingIpLen = createFloatingIp.length;
                if (creatFloatingIpLen > 0) {
                    for (var i = 0; i < creatFloatingIpLen; i++) {
                        var floatingIPURL = '/floating-ip/'+createFloatingIp[i]['uuid'];
                        commonUtils.createReqObj(DataObjectArr, floatingIPURL,
                                     global.HTTP_REQUEST_GET, null, configApiServer, null,
                                     appData);
                    }
                }
            }
            DataObjectLenDetail["FloatingIpCreateStartIndex"] = 0;
            DataObjectLenDetail["FloatingIpCreateCount"] = creatFloatingIpLen;

            //deleteFloatingIP();
            if (deleteFloatingip != null && deleteFloatingip != "") {
                deleteFloatingIpLen = deleteFloatingip.length;
                if (deleteFloatingIpLen > 0) {
                    for (var i = 0; i < deleteFloatingIpLen; i++) {
                        var floatingIPURL = '/floating-ip/'+deleteFloatingip[i]['uuid'];
                        commonUtils.createReqObj(DataObjectArr, floatingIPURL,
                                     global.HTTP_REQUEST_GET, null, configApiServer, null,
                                     appData);
                    }
                }
            }
            DataObjectLenDetail["FloatingIpDeleteStartIndex"] = DataObjectArr.length - deleteFloatingip.length;
            DataObjectLenDetail["FloatingIpDeleteCount"] = deleteFloatingip.length;
        });
    }

    if ("logical_router_back_refs" in portPutData["virtual-machine-interface"] ||
        "logical_router_back_refs" in vmiData["virtual-machine-interface"]) {
        var logicalRoutServerLen = 0;
        if ("logical_router_back_refs" in vmiData["virtual-machine-interface"]) {
            var logicalRouterURL = '/logical-router/'+vmiData["virtual-machine-interface"]["logical_router_back_refs"][0]['uuid'];
            commonUtils.createReqObj(DataObjectArr, logicalRouterURL,
             global.HTTP_REQUEST_GET, null, configApiServer, null,
             appData);
            logicalRoutServerLen = 1;
        }
        DataObjectLenDetail["LogicalRouterServerStartIndex"] = DataObjectArr.length - logicalRoutServerLen;
        DataObjectLenDetail["LogicalRouterServerCount"] = logicalRoutServerLen;

        var logicalRoutUILen = 0
        if ("logical_router_back_refs" in portPutData["virtual-machine-interface"]) {
            var logicalRouterURL = '/logical-router/'+portPutData["virtual-machine-interface"]["logical_router_back_refs"][0]['uuid'];
            commonUtils.createReqObj(DataObjectArr, logicalRouterURL,
             global.HTTP_REQUEST_GET, null, configApiServer, null,
             appData);
            logicalRoutUILen = 1;
        }
        DataObjectLenDetail["LogicalRouterUIStartIndex"] = DataObjectArr.length - logicalRoutUILen;
        DataObjectLenDetail["LogicalRouterUICount"] = logicalRoutUILen;
    }

    //fixed ip
    if ("instance_ip_back_refs" in portPutData["virtual-machine-interface"] ||
        "instance_ip_back_refs" in vmiData["virtual-machine-interface"]) {
        filterUpdateFixedIP(error, portPutData, vmiData, function(createFixedIp,deleteFixedip){
            if (createFixedIp != null && createFixedIp != "") {
                if (createFixedIp.length > 0) {
                    for (var i = 0; i < createFixedIp.length; i++) {
                        var fixedIPURL = '/instance-ips';
                        responceData = {};
                        responceData = createFixedIPDataObject(responceData,portPutData,createFixedIp[i]);
                        commonUtils.createReqObj(DataObjectArr, fixedIPURL,
                                     global.HTTP_REQUEST_POST, commonUtils.cloneObj(responceData), configApiServer, null,
                                     appData);
                    }
                }
            }
            DataObjectLenDetail["instanceIPCreateStartIndex"] = DataObjectArr.length - createFixedIp.length;
            DataObjectLenDetail["instanceIPCreateCount"] = createFixedIp.length;

            if (deleteFixedip != null && deleteFixedip != "") {
                if (deleteFixedip.length > 0) {
                    for (var i = 0; i < deleteFixedip.length; i++) {
                        var fixedIPURL = '/instance-ip/'+deleteFixedip[i]["uuid"];
                        commonUtils.createReqObj(DataObjectDelArr, fixedIPURL,
                                     global.HTTP_REQUEST_DEL, null, configApiServer, null,
                                     appData);
                    }
                }
            }
            DataObjectLenDetail["instanceIPDeleteStartIndex"] = DataObjectArr.length - deleteFixedip.length;
            DataObjectLenDetail["instanceIPDeleteCount"] = deleteFixedip.length;
        });
    }

    //Static Rout
    var DataSRObjectArr = [];
    if ("interface_route_table_refs" in portPutData["virtual-machine-interface"] ||
        "interface_route_table_refs" in vmiData["virtual-machine-interface"]) {
        var staticRouterLen_ui = 0;
        var staticRouterLen_server = 0;
        if ('interface_route_table_refs' in portPutData["virtual-machine-interface"])
            staticRouterLen_ui = portPutData["virtual-machine-interface"]["interface_route_table_refs"].length;

        if ('interface_route_table_refs' in vmiData["virtual-machine-interface"])
            staticRouterLen_server = vmiData["virtual-machine-interface"]["interface_route_table_refs"].length;

        var staticRouteURL = '/interface-route-tables';
        if (staticRouterLen_ui > 0) {
            if (portPutData["virtual-machine-interface"]["interface_route_table_refs"][0]["uuid"] == undefined ||
               portPutData["virtual-machine-interface"]["interface_route_table_refs"][0]["uuid"] == null ||
               portPutData["virtual-machine-interface"]["interface_route_table_refs"][0]["uuid"] == "") {
                responceData = {};
                responceData = createStaticIPDataObject(responceData,portPutData,portPutData["virtual-machine-interface"]["interface_route_table_refs"][0]["sharedip"]);
                portPutData["virtual-machine-interface"]["interface_route_table_refs"][0]["uuid"] = responceData["interface-route-table"]["uuid"];
                portPutData["virtual-machine-interface"]["interface_route_table_refs"][0]["to"] = responceData["interface-route-table"]["fq_name"];
                commonUtils.createReqObj(DataObjectArr, staticRouteURL,
                             global.HTTP_REQUEST_POST, commonUtils.cloneObj(responceData), configApiServer, null,
                             appData);
           } else {
                responceData = {};
                var SR_uuid = portPutData["virtual-machine-interface"]["interface_route_table_refs"][0]["uuid"];
                responceData = createStaticIPDataObject(responceData,portPutData,portPutData["virtual-machine-interface"]["interface_route_table_refs"][0]["sharedip"], SR_uuid);
                var staticRoutePutURL = "/interface-route-table/" +SR_uuid;
                commonUtils.createReqObj(DataObjectArr, staticRoutePutURL,
                             global.HTTP_REQUEST_PUT, commonUtils.cloneObj(responceData), configApiServer, null,
                             appData);
           }
        } else if (staticRouterLen_server > 0) {
            var SR_uuid = vmiData["virtual-machine-interface"]["interface_route_table_refs"][0]["uuid"];
            var staticRouteDelURL = "/interface-route-table/" +SR_uuid;
                commonUtils.createReqObj(DataSRObjectArr, staticRouteDelURL,
                    global.HTTP_REQUEST_DEL, null, configApiServer, null,
                    appData);
        }
    }
    var boolDeviceOwnerChange = true;

    if ("virtual_machine_interface_device_owner" in vmiData["virtual-machine-interface"] &&
        "virtual_machine_interface_device_owner" in portPutData["virtual-machine-interface"]) {
        if (vmiData["virtual-machine-interface"]["virtual_machine_interface_device_owner"] ==
           portPutData["virtual-machine-interface"]["virtual_machine_interface_device_owner"]) {
            if (vmiData["virtual-machine-interface"]["virtual_machine_interface_device_owner"] == "compute:nova") {
                if ("virtual_machine_refs" in vmiData["virtual-machine-interface"] &&
                    "virtual_machine_refs" in portPutData["virtual-machine-interface"]) {
                    if (vmiData["virtual-machine-interface"]["virtual_machine_refs"][0]["uuid"] ==
                        portPutData["virtual-machine-interface"]["virtual_machine_refs"][0]["uuid"]) {
                        boolDeviceOwnerChange = false;
                    }
                }
            } else if (vmiData["virtual-machine-interface"]["virtual_machine_interface_device_owner"] ==
                       "network:router_interface") {
                if ("logical_router_back_refs" in vmiData["virtual-machine-interface"] &&
                    "logical_router_back_refs" in portPutData["virtual-machine-interface"]) {
                    if (vmiData["virtual-machine-interface"]["logical_router_back_refs"][0]["uuid"] ==
                        portPutData["virtual-machine-interface"]["logical_router_back_refs"][0]["uuid"]) {
                        boolDeviceOwnerChange = false;
                    }
                }
            } else if (vmiData["virtual-machine-interface"]["virtual_machine_interface_device_owner"] == "" &&
                       portPutData["virtual-machine-interface"]["virtual_machine_interface_device_owner"] == "") {
                boolDeviceOwnerChange = false;
            }
        }
    }

    processDataObjects(error, DataObjectArr, DataObjectDelArr, DataSRObjectArr, vmiData, portPutData, DataObjectLenDetail, boolDeviceOwnerChange, request, appData,
    function(error, result){
        callback(error, result)
    });
}

/**
 * @processDataObjects
 * private function
 * 1. Callback for Ports update operations
 * 2. Compare the data from UI and data from server is compared and
 *    corresponding read/create/update data object is created.
 */
function processDataObjects (error, DataObjectArr, DataObjectDelArr, DataSRObjectArr, vmiData, portPutData, DataObjectLenDetail, boolDeviceOwnerChange, request, appData, callback)
{
    var portPutURL = '/virtual-machine-interface/';
    var vmiUUID = vmiData['virtual-machine-interface']['uuid'];
    portPutURL += vmiUUID;
    if (0 == DataObjectArr.length && 0 == DataObjectDelArr.length && 0 == DataSRObjectArr.length && boolDeviceOwnerChange == false) {
        //no change in floating or fixedip;
        updateVMI(DataSRObjectArr, portPutURL, portPutData, appData, function(error, data) {
            callback(error, data);
            return;
        });
    } else if (DataObjectArr.length > 0) {
        async.map(DataObjectArr,
        commonUtils.getServerResponseByRestApi(configApiServer, true),
        function(error, result) {
            linkUnlinkDetails(error, result, DataObjectLenDetail, portPutData, boolDeviceOwnerChange, vmiData, request, appData,
            function(error, results){
                if (error) {
                    callback(error, results);
                    return;
                } else {
                    deleteAllReference(DataObjectDelArr, DataSRObjectArr, portPutURL, portPutData, boolDeviceOwnerChange, appData, function(error, results){
                        callback(error, results);
                        return;
                    });
                }
            });
        });
    } else if (boolDeviceOwnerChange == true) {
        deviceOwnerChange(error, [], DataObjectArr, DataObjectLenDetail, portPutData, vmiData, request, appData, function(error, data, DataObjectArr){
            if (error) {
                callback(error, data);
            } else {
                deleteAllReference(DataObjectDelArr, DataSRObjectArr, portPutURL, portPutData, boolDeviceOwnerChange, appData, function(error, results){
                    callback(error, data);
                    return;
                });
            }
            if (DataObjectArr != null && DataObjectArr.length > 0) {
                async.map(DataObjectArr,
                commonUtils.getAPIServerResponse(configApiServer.apiPut, true),
                function(error, results) {
                    if (error) {
                        callback(error, results);
                        return;
                    }
                    deleteAllReference(DataObjectDelArr, DataSRObjectArr, portPutURL, portPutData, boolDeviceOwnerChange, appData, function(error, results){
                        callback(error, results);
                        return;
                    });
                });
            } else {
                deleteAllReference(DataObjectDelArr, DataSRObjectArr, portPutURL, portPutData, boolDeviceOwnerChange, appData, function(error, results){
                    callback(error, results);
                    return;
                });
            }
        });
    } else {
        deleteAllReference(DataObjectDelArr, DataSRObjectArr, portPutURL, portPutData, boolDeviceOwnerChange, appData, function(error, results){
            callback(error, results);
            return;
        });
    }
}

/**
 * @deleteAllReference
 * private function
 * 1. Callback for Ports update operations
 * 2. Send a call to delete all refence in DataObjectDelArr.
 * 3. If no DataObjectDelArr available then pass it to update VMI.
 */
function deleteAllReference (DataObjectDelArr, DataSRObjectArr, portPutURL, portPutData, boolDeviceOwnerChange, appData, callback)
{
    if (0 == DataObjectDelArr.length) {
        updateVMI(DataSRObjectArr, portPutURL, portPutData, appData, function(error, data) {
            callback(error, data);
            return;
        });
    } else {
        async.map(DataObjectDelArr,
        commonUtils.getAPIServerResponse(configApiServer.apiDelete, true),
        function(error, results) {
            updateVMI(DataSRObjectArr, portPutURL, portPutData, appData, function(error, data) {
               callback(error, data);
               return;
            });
        });
    }
}

/**
 * @updateVMI
 * private function
 * 1. Callback for Ports update operations
 * 2. Send a call to Update the VMI.
 */
function updateVMI (DataSRObjectArr, portPutURL, portPutData, appData, callback)
{
    portPutData = removeBackRef(portPutData)
    configApiServer.apiPut(portPutURL, portPutData, appData,
    function(error, data) {
        if (error) {
           callback(error, data);
            return;
        }
        if (DataSRObjectArr.length > 0) {
            async.map(DataSRObjectArr,
            commonUtils.getAPIServerResponse(configApiServer.apiDelete, true),
            function(error, results) {
                callback(error, results);
                return;
            });
        } else {
            callback(error, data);
            return;
        }
    });
}

/**
 * @removeBackRef
 * private function
 * 1. Callback for Ports update operations
 * 2. If any back refence is available in the object from UI
 *    remove it from the object
 */
function removeBackRef (portPutData)
{
    if ("instance_ip_back_refs" in portPutData["virtual-machine-interface"]) {
        delete portPutData["virtual-machine-interface"]["instance_ip_back_refs"];
    }
    if ("logical_router_back_refs" in portPutData["virtual-machine-interface"]) {
        delete portPutData["virtual-machine-interface"]["logical_router_back_refs"];
    }
    return portPutData;
}

/**
 * @linkUnlinkDetails
 * private function
 * 1. Callback for Ports update operations
 * 2. Updating detail for floating IP.
 * 3. if Device owner is chnged then call deviceOwnerChange
 *    to update device owner.
 */
function linkUnlinkDetails (error, result, DataObjectLenDetail, portPutData, boolDeviceOwnerChange, vmiData, request, appData, callback)
{
    var i=0;
    var DataObjectArr = [];
    for (i = DataObjectLenDetail["FloatingIpCreateStartIndex"]; i < DataObjectLenDetail["FloatingIpCreateStartIndex"]+DataObjectLenDetail["FloatingIpCreateCount"]; i++) {
        if (result[i] != null) {
            var floatingIPURL = '/floating-ip/'+result[i]['floating-ip']['uuid'];
            var responceData = createFloatingIPDataObject(responceData, portPutData, result[i]);
            commonUtils.createReqObj(DataObjectArr, floatingIPURL,
                                global.HTTP_REQUEST_PUT, commonUtils.cloneObj(responceData), null, null,
                                appData);
        }
    }
    for (i = DataObjectLenDetail["FloatingIpDeleteStartIndex"]; i < (DataObjectLenDetail["FloatingIpDeleteStartIndex"]+DataObjectLenDetail["FloatingIpDeleteCount"]); i++) {
        if (result[i] != null) {
            if ('floating-ip' in result[i] && 'virtual_machine_interface_refs' in result[i]['floating-ip']) {
                var floatingIPURL = '/floating-ip/'+result[i]['floating-ip']['uuid'];
                var vmiRef = result[i]['floating-ip']['virtual_machine_interface_refs'];
                var vmiRefLen = result[i]['floating-ip']['virtual_machine_interface_refs'].length;
                for (var j = 0; j < vmiRefLen; j++) {
                    if (vmiRef[j]['uuid'] == portPutData['virtual-machine-interface']['uuid']) {
                        result[i]['floating-ip']['virtual_machine_interface_refs'].splice(j,1);
                        j--;
                        vmiRefLen--;
                        commonUtils.createReqObj(DataObjectArr, floatingIPURL,
                           global.HTTP_REQUEST_PUT, result[i], null, null,
                           appData);
                        break;
                    }
                }
            }
        }
    }
    if (boolDeviceOwnerChange == true) {
        deviceOwnerChange(error, result, DataObjectArr, DataObjectLenDetail, portPutData, vmiData, request, appData, function(error, data, DataObjectArr){
            if (error) {
                callback(error, data);
                return;
            } else {
                if (DataObjectArr.length > 0) {
                    async.map(DataObjectArr,
                    commonUtils.getAPIServerResponse(configApiServer.apiPut, true),
                    function(error, results) {
                        callback(error, results);
                        return;
                    });
                } else {
                    callback(error, result);
                    return;
                }
            }
        });
    } else {
        if (DataObjectArr.length > 0) {
            async.map(DataObjectArr,
            commonUtils.getAPIServerResponse(configApiServer.apiPut, true),
            function(error, results) {
                callback(error, results);
                return;
            });
        } else {
            callback(error, results);
            return;
        }
    }
}

/**
 * @deviceOwnerChange
 * private function
 * 1. Callback for Ports update operations
 * 2. Update the device owner with corresponding
 *    router or compute function
 * 3. If any compute or router has to be detached
 *    even that is taken care.
 */
function deviceOwnerChange (error, result, DataObjectArr, DataObjectLenDetail, portPutData, vmiData, request, appData, callback)
{
    if ("virtual_machine_interface_device_owner" in vmiData["virtual-machine-interface"] &&
        vmiData["virtual-machine-interface"]["virtual_machine_interface_device_owner"] == "compute:None") {
        if ("virtual_machine_refs" in vmiData["virtual-machine-interface"]) {
            vmiData["virtual-machine-interface"]["virtual_machine_interface_device_owner"] = "compute:nova";
        } else if ("logical_router_back_refs" in vmiData["virtual-machine-interface"]) {
            vmiData["virtual-machine-interface"]["virtual_machine_interface_device_owner"] = "network:router_interface";
        } else {
            vmiData["virtual-machine-interface"]["virtual_machine_interface_device_owner"] = "";
        }
    }
    if ("virtual_machine_interface_device_owner" in portPutData["virtual-machine-interface"] &&
            "virtual_machine_interface_device_owner" in vmiData["virtual-machine-interface"]) {
        var serverIndex = DataObjectLenDetail["LogicalRouterServerStartIndex"];
        var serverCount = DataObjectLenDetail["LogicalRouterServerCount"];
        var uiIndex = DataObjectLenDetail["LogicalRouterUIStartIndex"];
        var uiCount = DataObjectLenDetail["LogicalRouterUICount"];
        if (vmiData["virtual-machine-interface"]["virtual_machine_interface_device_owner"] == "compute:nova") {
            if ((portPutData["virtual-machine-interface"]["virtual_machine_interface_device_owner"] != "compute:nova") ||
               ((portPutData["virtual-machine-interface"]["virtual_machine_interface_device_owner"] == "compute:nova") &&
               (vmiData["virtual-machine-interface"]["virtual_machine_refs"][0]["uuid"] != portPutData["virtual-machine-interface"][ "virtual_machine_refs"][0]["uuid"]))) {
                //detach compute nova
                var body = {};
                body.portID = vmiData["virtual-machine-interface"]["uuid"];
                body.netID = vmiData["virtual-machine-interface"]["virtual_network_refs"][0]["uuid"];
                body.vmUUID = vmiData["virtual-machine-interface"]["virtual_machine_refs"][0]["to"][0];
                detachVMICompute(request, body, function(error, results){
                    if (error) {
                        callback(error, result, DataObjectArr)
                        return;
                    }
                    //Add new Compute nova entrey
                    if (portPutData["virtual-machine-interface"]["virtual_machine_interface_device_owner"] == "compute:nova") {
                        body = {};
                        body.portID = portPutData["virtual-machine-interface"]["uuid"];
                        body.netID = portPutData["virtual-machine-interface"]["virtual_network_refs"][0]["uuid"];
                        body.vmUUID = portPutData["virtual-machine-interface"]["virtual_machine_refs"][0]["to"][0];
                        attachVMICompute(request, body, function(error, results){
                            callback(error, results, DataObjectArr);
                            return;
                        });
                    } else if (portPutData["virtual-machine-interface"]["virtual_machine_interface_device_owner"] == "network:router_interface") {
                    //Add new router entrey
                        if (result[uiIndex] != null) {
                            if (DataObjectLenDetail["LogicalRouterUICount"] == 1) {
                                var logicalRouterURL = '/logical-router/'+result[uiIndex]['logical-router']['uuid'];
                                var responceData = {};
                                var responceData = createlogicalRouterDataObject(responceData,portPutData,result[uiIndex]);
                                commonUtils.createReqObj(DataObjectArr, logicalRouterURL,
                                    global.HTTP_REQUEST_PUT, responceData, null, null,
                                    appData);
                                callback(error, result, DataObjectArr);
                                return;
                            } else {
                                callback(error, result, DataObjectArr);
                                return;
                            }
                        } else {
                            //No attach/edit
                            callback(error, result, DataObjectArr);
                            return;
                        }
                    }
                });
            } else {
                //No change in compute nova
                callback(null, vmiData);
                return;
            }
        }

        if (vmiData["virtual-machine-interface"]["virtual_machine_interface_device_owner"] == "network:router_interface") {
            if (portPutData["virtual-machine-interface"]["virtual_machine_interface_device_owner"] != "network:router_interface"
               || ((portPutData["virtual-machine-interface"]["virtual_machine_interface_device_owner"] == "network:router_interface") &&
                  "logical_router_back_refs" in vmiData["virtual-machine-interface"] &&
                  vmiData["virtual-machine-interface"]["logical_router_back_refs"].length > 0 &&
                  "uuid" in vmiData["virtual-machine-interface"]["logical_router_back_refs"][0] &&
                  vmiData["virtual-machine-interface"]["logical_router_back_refs"][0]["uuid"] != portPutData["virtual-machine-interface"]["logical_router_back_refs"][0]["uuid"])) {
                // Detach Logical router
                if (serverCount == 1 && result[serverIndex] != null && 'logical-router' in result[serverIndex]) {
                    var logicalRouterURL = '/logical-router/'+result[serverIndex]['logical-router']['uuid'];
                    if ('virtual_machine_interface_refs' in result[serverIndex]['logical-router']) {
                        var vmiRef = result[serverIndex]['logical-router']['virtual_machine_interface_refs'];
                        var vmiRefLen = result[serverIndex]['logical-router']['virtual_machine_interface_refs'].length;
                        for (var j = 0 ; j < vmiRefLen ; j++) {
                            if (vmiRef[j]['uuid'] == portPutData['virtual-machine-interface']['uuid']) {
                                result[serverIndex]['logical-router']['virtual_machine_interface_refs'].splice(j,1);
                                var logicalRouterObj = {};
                                logicalRouterObj = genarateLogicalRouterObj(result[serverIndex],logicalRouterObj);
                                j = vmiRefLen;
                                //detaching the vmi from logical rout
                                configApiServer.apiPut(logicalRouterURL, logicalRouterObj, appData,
                                function(error, data) {
                                    if (error) {
                                        callback(error, result, DataObjectArr);
                                        return;
                                    }
                                    if (portPutData["virtual-machine-interface"]["virtual_machine_interface_device_owner"] == "network:router_interface") {
                                        //Attaching the new Logical router
                                        var logicalRouterURL = '/logical-router/'+result[uiIndex]['logical-router']['uuid'];
                                        var vmiIndexinLR = -1;

                                        if ('virtual_machine_interface_refs' in result[uiIndex]['logical-router']) {
                                            vmiIndexinLR = result[uiIndex]['logical-router']['virtual_machine_interface_refs'].length;
                                        }
                                        if (vmiIndexinLR == -1) {
                                            result[uiIndex]["logical-router"]["virtual_machine_interface_refs"] = [];
                                            vmiIndexinLR++;
                                        }
                                        result[uiIndex]["logical-router"]["virtual_machine_interface_refs"][vmiIndexinLR] = {};
                                        result[uiIndex]["logical-router"]["virtual_machine_interface_refs"][vmiIndexinLR]["to"] = portPutData['virtual-machine-interface']["fq_name"];
                                        result[uiIndex]["logical-router"]["virtual_machine_interface_refs"][vmiIndexinLR]["uuid"] = portPutData['virtual-machine-interface']['uuid'];
                                        var logicalRouterObj = {};
                                        logicalRouterObj = genarateLogicalRouterObj(result[uiIndex],logicalRouterObj);
                                        commonUtils.createReqObj(DataObjectArr, logicalRouterURL,
                                            global.HTTP_REQUEST_PUT, logicalRouterObj, null, null,
                                            appData);
                                        callback(error, result, DataObjectArr);
                                        return;
                                    } else if (portPutData["virtual-machine-interface"]["virtual_machine_interface_device_owner"] == "compute:nova") {
                                        //Attach the new compute Nova
                                        body = {};
                                        body.portID = portPutData["virtual-machine-interface"]["uuid"];
                                        body.netID = portPutData["virtual-machine-interface"]["virtual_network_refs"][0]["uuid"];
                                        body.vmUUID = portPutData["virtual-machine-interface"]["virtual_machine_refs"][0]["to"][0];
                                        attachVMICompute(request, body, function(error, results){
                                            callback(error, result, DataObjectArr);
                                            return;
                                        });
                                    } else {
                                        // No attach or editof logical rout
                                        callback(error, result, DataObjectArr);
                                        return;
                                    }
                                });
                            }
                        }
                    }
                } else {
                    // If Api serveris nothaving any data of Logical Router
                    vmiData["virtual-machine-interface"]["virtual_machine_interface_device_owner"] = "";
                }
            } else {
                // if Routerbackref is missing in the logical router.
                if (("logical_router_back_refs" in vmiData["virtual-machine-interface"]) &&
                (vmiData["virtual-machine-interface"]["logical_router_back_refs"].length > 0) &&
                ("uuid" in vmiData["virtual-machine-interface"]["logical_router_back_refs"][0])) {
                    // No change in Route table
                    callback(error, result, DataObjectArr);
                    return;
                } else {
                    vmiData["virtual-machine-interface"]["virtual_machine_interface_device_owner"] = "";
                }
            }
        }

        if (vmiData["virtual-machine-interface"]["virtual_machine_interface_device_owner"] == "") {
            if (portPutData["virtual-machine-interface"]["virtual_machine_interface_device_owner"] == "network:router_interface") {
                var logicalRouterURL = '/logical-router/'+result[uiIndex]['logical-router']['uuid'];
                var vmiIndexinLR = -1;
                if ('virtual_machine_interface_refs' in result[uiIndex]['logical-router']) {
                    vmiIndexinLR = result[uiIndex]['logical-router']['virtual_machine_interface_refs'].length;
                }
                if (vmiIndexinLR == -1) {
                    result[uiIndex]["logical-router"]["virtual_machine_interface_refs"] = [];
                    vmiIndexinLR++;
                }
                result[uiIndex]["logical-router"]["virtual_machine_interface_refs"][vmiIndexinLR] = {};
                result[uiIndex]["logical-router"]["virtual_machine_interface_refs"][vmiIndexinLR]["to"] = portPutData['virtual-machine-interface']["fq_name"];
                result[uiIndex]["logical-router"]["virtual_machine_interface_refs"][vmiIndexinLR]["uuid"] = portPutData['virtual-machine-interface']['uuid'];

                commonUtils.createReqObj(DataObjectArr, logicalRouterURL,
                    global.HTTP_REQUEST_PUT, result[uiIndex], null, null,
                    appData);
                callback(error, result, DataObjectArr);
                return;
            } else if (portPutData["virtual-machine-interface"]["virtual_machine_interface_device_owner"] == "compute:nova") {
                //Attach the new compute Nova
                body = {};
                body.portID = portPutData["virtual-machine-interface"]["uuid"];
                body.netID = portPutData["virtual-machine-interface"]["virtual_network_refs"][0]["uuid"];
                body.vmUUID = portPutData["virtual-machine-interface"]["virtual_machine_refs"][0]["to"][0];
                attachVMICompute(request, body, function(error, results){
                    callback(error, results, DataObjectArr);
                    return;
                });
            } else {
                // No attach or editof logical rout
                callback(error, result, DataObjectArr);
                return;
            }
        }
    } else {
        callback(error, result, DataObjectArr);
        return;
    }
}

/**
 * @genarateLogicalRouterObj
 * private function
 * 1. Callback for Ports update operations
 * 2. When logical router is set the object is genated
 *    with the corresponding values
 */
function genarateLogicalRouterObj (logicalRouter, logicalRouterObj)
{
    var returnObject = {};
    returnObject['logical-router'] = {};
    returnObject['logical-router']['fq_name'] = logicalRouter['logical-router']['fq_name'];
    returnObject['logical-router']['uuid'] = logicalRouter['logical-router']['uuid'];
    var vmiLength = logicalRouter['logical-router']['virtual_machine_interface_refs'].length;
    returnObject['logical-router']['virtual_machine_interface_refs'] = [];
    if (vmiLength > 0) {
        for (var i = 0; i < vmiLength; i++) {
            if (logicalRouter['logical-router']['virtual_machine_interface_refs'][i] != null) {
                returnObject['logical-router']['virtual_machine_interface_refs'][i] = {};
                returnObject['logical-router']['virtual_machine_interface_refs'][i]["to"] = logicalRouter['logical-router']['virtual_machine_interface_refs'][i]["to"];
                returnObject['logical-router']['virtual_machine_interface_refs'][i]["uuid"] = logicalRouter['logical-router']['virtual_machine_interface_refs'][i]["uuid"];
            }
        }
    }
    logicalRouterObj = returnObject;
    return logicalRouterObj;
}

/**
 * @filterUpdateLogicalRouter
 * private function
 * 1. Callback for Ports update operations
 * 2. filtering the logical router values either to create or delete.
 */
function filterUpdateLogicalRouter (error, portPutData, vmiData, callback)
{
    var i = 0;
    var postCopyData = [];
    var createlogicalRouterArray = [];
    var deletelogicalRouterArray = [];
    var logicalRouteripPoolRef_server = [];
    var logicalRouteripPoolRefs_serverLen = 0;
    var logicalRouteripPoolRef_put = [];
    var logicalRouteripPoolRefs_putLen = 0;

    if ('virtual-machine-interface' in vmiData &&
        'logical_router_back_refs' in vmiData['virtual-machine-interface']) {
        logicalRouteripPoolRef_server = vmiData['virtual-machine-interface']['logical_router_back_refs'];
        logicalRouteripPoolRefs_serverLen = logicalRouteripPoolRef_server.length;
    }
    if ('virtual-machine-interface' in portPutData &&
        'logical_router_back_refs' in portPutData['virtual-machine-interface']) {
        logicalRouteripPoolRef_put = portPutData['virtual-machine-interface']['logical_router_back_refs'];
        logicalRouteripPoolRefs_putLen = logicalRouteripPoolRef_put.length;
    }
    if (logicalRouteripPoolRefs_serverLen == 0) {
        for (i = 0; i < logicalRouteripPoolRefs_putLen; i++) {
            createlogicalRouterArray.push(logicalRouteripPoolRef_put[i]);
        }
        callback(createlogicalRouterArray,deletelogicalRouterArray);
        return;

    }
    if (logicalRouteripPoolRefs_putLen == 0) {
        for (i = 0; i < logicalRouteripPoolRefs_serverLen; i++) {
            deletelogicalRouterArray.push(logicalRouteripPoolRef_server[i]);
        }
        callback(createlogicalRouterArray,deletelogicalRouterArray);
        return;
    }
    var j = 0;
    var create = true;
    for (i = 0; i < logicalRouteripPoolRefs_putLen; i++) {
        create = true;
        for (j = 0; j < logicalRouteripPoolRefs_serverLen && i >= 0; j++) {
            var portlogicalRouterip_fqname = JSON.stringify(logicalRouteripPoolRef_put[i]["to"]);
            var vmilogicalRouterip_fqname = JSON.stringify(logicalRouteripPoolRef_server[j]["to"]);
            if (portlogicalRouterip_fqname == vmilogicalRouterip_fqname) {
                logicalRouteripPoolRef_put.splice(i,1);
                logicalRouteripPoolRef_server.splice(j,1);
                create = false;
                i--;
                j--;
                logicalRouteripPoolRefs_putLen = logicalRouteripPoolRef_put.length;
                logicalRouteripPoolRefs_serverLen = logicalRouteripPoolRef_server.length;
            }
        }
        if (create == true) {
            createlogicalRouterArray.push(logicalRouteripPoolRef_put[i]);
            logicalRouteripPoolRef_put.splice(i,1);
            i--;
            logicalRouteripPoolRefs_putLen = logicalRouteripPoolRef_put.length;
        }
    }
    for (j = 0; j < logicalRouteripPoolRefs_serverLen; j++) {
        deletelogicalRouterArray.push(logicalRouteripPoolRef_server[j]);
    }
    callback(createlogicalRouterArray,deletelogicalRouterArray);
}

/**
 * @filterUpdateFloatingIP
 * private function
 * 1. Callback for Ports update operations
 * 2. filtering the floating IP values either to create or delete.
 */
function filterUpdateFloatingIP (error, portPutData, vmiData, callback)
{
    var i = 0;
    var postCopyData = [];
    var createFloatingArray = [];
    var deleteFloatingArray = [];
    var floatingipPoolRef_server = [];
    var floatingipPoolRefs_serverLen = 0;
    var floatingipPoolRef_put = [];
    var floatingipPoolRefs_putLen = 0;

    if ('virtual-machine-interface' in vmiData &&
        'floating_ip_back_refs' in vmiData['virtual-machine-interface']) {
        floatingipPoolRef_server = vmiData['virtual-machine-interface']['floating_ip_back_refs'];
        floatingipPoolRefs_serverLen = floatingipPoolRef_server.length;
    }
    if ('virtual-machine-interface' in portPutData &&
        'floating_ip_back_refs' in portPutData['virtual-machine-interface']) {
        floatingipPoolRef_put = portPutData['virtual-machine-interface']['floating_ip_back_refs'];
        floatingipPoolRefs_putLen = floatingipPoolRef_put.length;
    }
    if (floatingipPoolRefs_serverLen == 0) {
        for (i = 0; i < floatingipPoolRefs_putLen; i++) {
            createFloatingArray.push(floatingipPoolRef_put[i]);
        }
        callback(createFloatingArray,deleteFloatingArray);
        return;

    }
    if (floatingipPoolRefs_putLen == 0) {
        for (i = 0; i < floatingipPoolRefs_serverLen; i++) {
            deleteFloatingArray.push(floatingipPoolRef_server[i]);
        }
        callback(createFloatingArray,deleteFloatingArray);
        return;
    }
    var j = 0;
    var create = true;
    for (i = 0; i < floatingipPoolRefs_putLen; i++) {
        create = true;
        for (j = 0; j < floatingipPoolRefs_serverLen && i >= 0; j++){
            var portFloatingip_fqname = JSON.stringify(floatingipPoolRef_put[i]["to"]);
            var vmiFloatingip_fqname = JSON.stringify(floatingipPoolRef_server[j]["to"]);
            if (portFloatingip_fqname == vmiFloatingip_fqname) {
                floatingipPoolRef_put.splice(i,1);
                floatingipPoolRef_server.splice(j,1);
                create = false;
                i--;
                j--;
                floatingipPoolRefs_putLen = floatingipPoolRef_put.length;
                floatingipPoolRefs_serverLen = floatingipPoolRef_server.length;
            }
        }
        if (create == true) {
            createFloatingArray.push(floatingipPoolRef_put[i]);
            floatingipPoolRef_put.splice(i,1);
            i--;
            floatingipPoolRefs_putLen = floatingipPoolRef_put.length;
        }
    }
    for (j = 0; j < floatingipPoolRefs_serverLen; j++) {
        deleteFloatingArray.push(floatingipPoolRef_server[j]);
    }
    callback(createFloatingArray,deleteFloatingArray);
}

/**
 * @filterUpdateFixedIP
 * private function
 * 1. Callback for Ports update operations
 * 2. filtering the fixed IP values either to create or delete.
 */
function filterUpdateFixedIP (error, portPutData, vmiData, callback)
{
    var i = 0;
    var postCopyData = [];
    var createFixedArray = [];
    var deleteFixedArray = [];
    var fixedipPoolRef_server = [];
    var fixedipPoolRefs_serverLen = 0;
    var fixedipPoolRef_put = [];
    var fixedipPoolRefs_putLen = 0;
    if ('virtual-machine-interface' in vmiData &&
        'instance_ip_back_refs' in vmiData['virtual-machine-interface']) {
        fixedipPoolRef_server = vmiData['virtual-machine-interface']['instance_ip_back_refs'];
        fixedipPoolRefs_serverLen = fixedipPoolRef_server.length;
    }
    if ('virtual-machine-interface' in portPutData &&
        'instance_ip_back_refs' in portPutData['virtual-machine-interface']) {
        fixedipPoolRef_put = portPutData['virtual-machine-interface']['instance_ip_back_refs'];
        fixedipPoolRefs_putLen = fixedipPoolRef_put.length;
    }
    if (fixedipPoolRefs_serverLen == 0) {
        for (i = 0; i < fixedipPoolRefs_putLen; i++) {
            createFixedArray.push(fixedipPoolRef_put[i]);
        }
        callback(createFixedArray,deleteFixedArray);
        return;
    }
    if (fixedipPoolRefs_putLen == 0) {
        for (i = 0; i < fixedipPoolRefs_serverLen; i++) {
            deleteFixedArray.push(fixedipPoolRef_server[i]);
        }
        callback(createFixedArray,deleteFixedArray);
        return;
    }
    var j = 0;
    var create = true;
    for (i = 0; i < fixedipPoolRefs_putLen && i >= 0; i++) {
        create = true;
        for (j = 0; j < fixedipPoolRefs_serverLen && j >= 0 && i >= 0; j++) {
            var portFixedip_uuid = JSON.stringify(fixedipPoolRef_put[i]["uuid"]);
            var vmiFixedip_uuid = JSON.stringify(fixedipPoolRef_server[j]["uuid"]);
            if ( portFixedip_uuid == vmiFixedip_uuid) {
                fixedipPoolRef_put.splice(i,1);
                fixedipPoolRef_server.splice(j,1);
                create = false;
                i--;
                j--;
                fixedipPoolRefs_putLen--;
                fixedipPoolRefs_serverLen--;
            }
        }
        if (create == true) {
            createFixedArray.push(fixedipPoolRef_put[i]);
            fixedipPoolRef_put.splice(i,1);
            i--;
            fixedipPoolRefs_putLen--;
        }
    }
    for (j = 0; j < fixedipPoolRefs_serverLen; j++) {
        deleteFixedArray.push(fixedipPoolRef_server[j]);
    }

    callback(createFixedArray,deleteFixedArray);
}

/**
 * @deletePortsCB
 * public function
 * 1. Call from other API call
 * 2. Deletes the ports from config api server
 * 3. Return back to the called API
 */
function deletePortsCB (dataObject, callback)
{
    var appData =  dataObject.appData;
    var portId = dataObject.uuid;
    var request = dataObject.request;
    readVMIwithUUID(portId, appData, function(err, vmiData){
        getReadDelVMICb(err, vmiData, request, appData, function(error, data){
            callback(error, data);
            return;
        });
    });
}

/**
 * @deletePorts
 * public function
 * 1. URL /api/tenants/config/ports/:id
 * 2. Deletes the ports from config api server
 */
function deletePorts (request, response, appData)
{
    var portId = request.param('uuid');
    readVMIwithUUID(portId, appData, function(err, vmiData){
        getReadDelVMICb(err, vmiData, request, appData, function(error, data){
            commonUtils.handleJSONResponse(error, response, data);
            return;
        });
    });
}

/**
 * @readVMIwithUUID
 * private function
 * 1. Common function
 * 2. Read the VMI from server with the UUID
 */
function readVMIwithUUID (uuid, appData, callback)
{
    var vmiURL = '/virtual-machine-interface/';
    if (uuid != null && uuid != "") {
        vmiURL += uuid;
    } else {
        var error = new appErrors.RESTServerError('Port UUID is required.');
        callback(error, null);
        return;
    }
    configApiServer.apiGet(vmiURL, appData, function(err, data) {
        callback(err, data);
    });

}

/**
 * @readLogicalRouter
 * private function
 * 1. Callback for port create
 * 2. Read the Logical router and send back the result.
 */
function readLogicalRouter (uuid, appData, callback)
{
    var lrURL = '/logical-router/';
    if (uuid != null && uuid != "") {
        lrURL += uuid;
    configApiServer.apiGet(lrURL, appData, function(err, data) {
        callback(err, data);
    });
    } else {
        callback(null, null);
    }
}

/**
 * @deletePortAsync
 * private function
 * 1. Callback for delete create
 * 2. Execute One delete function at a time.
 */
function deletePortAsync (dataObj, callback)
{
    if (dataObj['type'] == 'instance-ip') {
        async.map(dataObj['dataObjArr'],
            function(item,callback) {
                commonUtils.getAPIServerResponse(configApiServer.apiDelete, false,item,callback)
            },
            function(error, results) {
                callback(error, results);
                return;
            });
        //return;
    } else if (dataObj['type'] == 'vmi') {
        var vmiData = dataObj['vmiData'];
        var request = dataObj['request'];
        if (vmiData["virtual-machine-interface"]["virtual_machine_interface_device_owner"] == "compute:nova") {
            //detach compute nova
            var body = {};
            body.portID = vmiData["virtual-machine-interface"]["uuid"];
            body.netID = vmiData["virtual-machine-interface"]["virtual_network_refs"][0]["uuid"];
            body.vmUUID = vmiData["virtual-machine-interface"]["virtual_machine_refs"][0]["to"][0];
            detachVMICompute(request, body, function(error, results){
                if (error) {
                    callback(error, results)
                    return;
                } else {
                    async.map(dataObj['dataObjArr'],
                    function(item,callback) {
                        commonUtils.getAPIServerResponse(configApiServer.apiDelete, false,item,callback)
                    },
                        function(error, results) {
                            callback(error, results);
                            return;
                        });
                }
            });
        } else {
            async.map(dataObj['dataObjArr'],
                function(item,callback) {
                    commonUtils.getAPIServerResponse(configApiServer.apiDelete, false,item,callback)
                },
                function(error, results) {
                    callback(error, results);
                    return;
                });
        }
        //return;
    } else if (dataObj['type'] == 'floating-ip') {
        async.map(dataObj['dataObjArr'],
            function(item,callback) {
                commonUtils.getAPIServerResponse(configApiServer.apiGet, false,item,callback)
            },
            function(error, results) {
                vmiDelFloatingIP(error, results, dataObj['vmiData'],
                                    dataObj['appData'], function(err, data){
                        callback(error, results);
                        //return;
                });
        });
        return;
    } else if (dataObj['type'] == 'logicalInterface') {
        async.map(dataObj['dataObjArr'],
            function(item,callback) {
                commonUtils.getAPIServerResponse(configApiServer.apiGet, false,item,callback)
            },
            function(error, results) {
                vmiDelLogicalInterface(error, results, dataObj['vmiData'],
                                    dataObj['appData'], function(err, data){
                        callback(error, results);
                        //return;
                });
        });
        return;
    } else if (dataObj['type'] == 'vm') {
        async.map(dataObj['dataObjArr'],
            function(item,callback) {
                commonUtils.getAPIServerResponse(configApiServer.apiGet, false,item,callback)
            },
            function(error, results) {
                delVm(error, results, dataObj['appData'],
                    function(err, data){
                        callback(error, results);
                        //return;
                });
        });
        return;
    } else if (dataObj['type'] == 'logical-router') {
        async.map(dataObj['dataObjArr'],
            function(item,callback) {
                commonUtils.getAPIServerResponse(configApiServer.apiGet, false,item,callback)
            },
            function(error, results) {
                vmiDelLogicalRout(error, results, dataObj['vmiData'],
                     dataObj['appData'], function(err, data){
                        callback(error, results);
                        return;
                });
        });
        //return;
    } else if (dataObj['type'] == 'staticRout') {
        async.map(dataObj['dataObjArr'],
            function(item,callback) {
                commonUtils.getAPIServerResponse(configApiServer.apiDelete, false,item,callback)
            },
            function(error, results) {
                callback(error, results);
                return;
            });
        //return;
    } else {
        callback(null, dataObj);
        return;
    }
}

/**
 * @getReadDelVMICb
 * private function
 * 1. Callback for delete create
 * 2. Read all the date to delete and create allDataObj.
 * 3. deletePortAsync is called in the same order of allDataObj.
 */
function getReadDelVMICb (err, vmiData, request, appData, callback)
{
    var floatingIPdataObjArr            = [];
    var logicalInterfaceObjArr            = [];
    var logicalRouterdataObjArr            = [];
    var vnObjArr            = [];
    var instanceIPdataObjArr            = [];
    var staticRoutObjArr            = [];
    var vmiObjArr            = [];
    var allDataObj            = [];
    var floatingipPoolRefsLen = 0;
    var fixedipPoolRefsLen    = 0;
    var logicalRouterRefLen    = 0;
    var logicalInterfaceRefLen    = 0;
    var vmRefLen    = 0;
    var floatingipPoolRef     = null;
    var logicalInterfaceRef     = null;
    var logicalRouterRef     = null;
    var fixedipPoolRef        = null;
    var vmRef        = null;
    var floatingipObj         = null;
    var logicalInterfaceObj         = null;
    var reqUrl                = "";

    var uuid = vmiData['virtual-machine-interface']['uuid'];

    if ('virtual-machine-interface' in vmiData &&
        'floating_ip_back_refs' in vmiData['virtual-machine-interface']) {
        floatingipPoolRef = vmiData['virtual-machine-interface']['floating_ip_back_refs'];
        floatingipPoolRefsLen = floatingipPoolRef.length;
    }
    for (i = 0; i < floatingipPoolRefsLen; i++) {
        reqUrl = '/floating-ip/' + floatingipPoolRef[i]['uuid'];
        commonUtils.createReqObj(floatingIPdataObjArr, reqUrl,
                                 global.HTTP_REQUEST_GET, null, null, null,
                                 appData);

    }

    if (floatingIPdataObjArr.length > 0) {
        var floatingIPObj = {};
        floatingIPObj['type'] = "floating-ip";
        floatingIPObj['dataObjArr'] = floatingIPdataObjArr;
        floatingIPObj['vmiData'] = vmiData;
        floatingIPObj['appData'] = appData;
        allDataObj.push(floatingIPObj);
    }

    if ('virtual-machine-interface' in vmiData &&
        'logical_interface_back_refs' in vmiData['virtual-machine-interface']) {
        logicalInterfaceRef = vmiData['virtual-machine-interface']['logical_interface_back_refs'];
        logicalInterfaceRefLen = logicalInterfaceRef.length;
    }
    for (i = 0; i < logicalInterfaceRefLen; i++) {
        reqUrl = '/logical-interface/' + logicalInterfaceRef[i]['uuid'];
        commonUtils.createReqObj(logicalInterfaceObjArr, reqUrl,
                                 global.HTTP_REQUEST_GET, null, null, null,
                                 appData);

    }
    if (logicalInterfaceObjArr.length > 0) {
        logicalInterfaceObj = {};
        logicalInterfaceObj['type'] = "logicalInterface";
        logicalInterfaceObj['dataObjArr'] = logicalInterfaceObjArr;
        logicalInterfaceObj['vmiData'] = vmiData;
        logicalInterfaceObj['appData'] = appData;
        allDataObj.push(logicalInterfaceObj);
    }

    //LogicalRouter Reference
    if ('virtual-machine-interface' in vmiData &&
        'logical_router_back_refs' in vmiData['virtual-machine-interface']) {
        logicalRouterRef = vmiData['virtual-machine-interface']['logical_router_back_refs'];
        logicalRouterRefLen = logicalRouterRef.length;
    }
    for (i = 0; i < logicalRouterRefLen; i++) {
        reqUrl = '/logical-router/' + logicalRouterRef[i]['uuid'];
        commonUtils.createReqObj(logicalRouterdataObjArr, reqUrl,
                                 global.HTTP_REQUEST_GET, null, null, null,
                                 appData);

    }
    if (logicalRouterdataObjArr.length > 0) {
        var logicalRouterObj = {};
        logicalRouterObj['type'] = "logical-router";
        logicalRouterObj['dataObjArr'] = logicalRouterdataObjArr;
        logicalRouterObj['vmiData'] = vmiData;
        logicalRouterObj['appData'] = appData;
        allDataObj.push(logicalRouterObj);
    }

    //Instance IP
    if ('instance_ip_back_refs' in vmiData['virtual-machine-interface']) {
        fixedipPoolRef = vmiData['virtual-machine-interface']['instance_ip_back_refs'];
        fixedipPoolRefsLen = fixedipPoolRef.length;
    }

    for (var i = 0; i < fixedipPoolRefsLen; i++) {
        reqUrl = '/instance-ip/' + fixedipPoolRef[i]['uuid'];
        commonUtils.createReqObj(instanceIPdataObjArr, reqUrl,
                                 global.HTTP_REQUEST_DEL, null, null, null,
                                 appData);
    }

    if (instanceIPdataObjArr.length > 0) {
        var instanceIPObj = {};
        instanceIPObj['type'] = "instance-ip";
        instanceIPObj['dataObjArr'] = instanceIPdataObjArr;
        allDataObj.push(instanceIPObj);
    }

    reqUrl = '/virtual-machine-interface/' + uuid;
    commonUtils.createReqObj(vmiObjArr, reqUrl,
                             global.HTTP_REQUEST_DEL, null, null, null,
                             appData);
    var vmiObj = {};
    if (vmiObjArr.length > 0) {
        vmiObj['type'] = "vmi";
        vmiObj['dataObjArr'] = vmiObjArr;
        vmiObj['vmiData'] = vmiData;
        vmiObj['request'] = request;
        allDataObj.push(vmiObj);
    }

    var staticRoutRef = [];
    var staticRoutRefLen = 0;
    if ('interface_route_table_refs' in vmiData['virtual-machine-interface']) {
        staticRoutRef = vmiData['virtual-machine-interface']['interface_route_table_refs'];
        staticRoutRefLen = staticRoutRef.length;
    }
    for (var i = 0; i < staticRoutRefLen ; i++) {
        reqUrl = '/interface-route-table/' + staticRoutRef[i]['uuid'];
        commonUtils.createReqObj(staticRoutObjArr, reqUrl,
                                 global.HTTP_REQUEST_DEL, null, null, null,
                                 appData);
    }
    if (staticRoutObjArr.length > 0) {
        var statObj = {};
        statObj['type'] = "staticRout";
        statObj['dataObjArr'] = staticRoutObjArr;
        allDataObj.push(statObj);
    }

    //virtual machine
    if ('virtual-machine-interface' in vmiData &&
        'virtual_machine_refs' in vmiData['virtual-machine-interface']) {
        vmRef = vmiData['virtual-machine-interface']['virtual_machine_refs'];
        vmRefLen = vmRef.length;
    }
    if (vmRefLen == 1) {
        reqUrl = '/virtual-machine/' + vmRef[0]['uuid'];
        commonUtils.createReqObj(vnObjArr, reqUrl,
                                 global.HTTP_REQUEST_GET, null, null, null,
                                 appData);
    }

    if (vnObjArr.length > 0) {
        var vmObj = {};
        vmObj['type'] = "vm";
        vmObj['dataObjArr'] = vnObjArr;
        vmObj['appData'] = appData;
        allDataObj.push(vmObj);
    }

    async.mapSeries(allDataObj, deletePortAsync, function(err, data) {
        callback(err, null);
    });
}

/**
 * @delVm
 * private function
 * 1. Callback for delete create
 * 2. call back for deletePortAsync.
 * 3. Delete Virtual machine.
 */
function delVm (error, results, appData, callback)
{
    if (error) {
        callback(error, results);
        return;
    }
    var linkedvmi2vmLength = 0;
    if ('virtual-machine' in results[0] && 'virtual_machine_interface_back_refs' in results[0]['virtual-machine']) {
        linkedvmi2vmLength = results[0]['virtual-machine']['virtual_machine_interface_back_refs'].length;
    }
    if (linkedvmi2vmLength <= 0) {
        var vmDelURL = "/virtual-machine/"+results[0]['virtual-machine']["uuid"];
        configApiServer.apiDelete(vmDelURL, appData,
        function(error, data) {
            callback(error, data);
        });
    } else {
        callback(error, results);
    }
}

/**
 * @vmiDelLogicalInterface
 * private function
 * 1. Callback for delete create
 * 2. call back for deletePortAsync.
 * 3. Update/Remove the reference of Logical Interface.
 */
function vmiDelLogicalInterface(error, results, vmiData, appData, callback)
{
    if (error) {
        callback(error, results, null);
        return;
    }
    var vmiUUID = vmiData['virtual-machine-interface']['uuid'];
    var i = 0;
    var DataObjectArr = []
    if (results.length > 0) {
    var resultLength = results.length;
        for (i = 0; i < resultLength; i++) {
            if (results[i] != null) {
                if ('logical-interface' in results[i] && 'virtual_machine_interface_refs' in results[i]['logical-interface']) {
                var logivalInterfaceURL = '/logical-interface/'+results[i]['logical-interface']['uuid'];
                    var vmiRef = results[i]['logical-interface']['virtual_machine_interface_refs'];
                    var vmiRefLen = results[i]['logical-interface']['virtual_machine_interface_refs'].length;
                    for (var j = 0; j < vmiRefLen; j++) {
                        if (vmiRef[j]['uuid'] == vmiUUID) {
                            results[i]['logical-interface']['virtual_machine_interface_refs'].splice(j,1);
                            j--;
                            vmiRefLen--;
                            commonUtils.createReqObj(DataObjectArr, logivalInterfaceURL,
                            global.HTTP_REQUEST_PUT, results[i], null, null,
                            appData);
                        }
                    }
                }
            }
        }
    }
    if (DataObjectArr.length > 0) {
        async.map(DataObjectArr,
              function(item,callback) {
                commonUtils.getAPIServerResponse(configApiServer.apiPut, true,item,callback)
              },
              function(error, results) {
                callback(error, results);
                return
              });
    } else {
        callback(error,null);
    }
}

/**
 * @vmiDelFloatingIP
 * private function
 * 1. Callback for delete create
 * 2. call back for deletePortAsync.
 * 3. Remove the reference of Floating IP.
 */
function vmiDelFloatingIP (error, results, vmiData, appData, callback)
{
    if (error) {
        callback(error, results, null);
        return;
    }
    var vmiUUID = vmiData['virtual-machine-interface']['uuid'];
    var i = 0;
    var DataObjectArr = []
    if (results.length > 0) {
    var resultLength = results.length;
        for (i = 0; i < resultLength; i++) {
            if (results[i] != null) {
                if ('floating-ip' in results[i] && 'virtual_machine_interface_refs' in results[i]['floating-ip']) {
                var floatingIPURL = '/floating-ip/'+results[i]['floating-ip']['uuid'];
                    var vmiRef = results[i]['floating-ip']['virtual_machine_interface_refs'];
                    var vmiRefLen = results[i]['floating-ip']['virtual_machine_interface_refs'].length;
                    for (var j = 0; j < vmiRefLen; j++) {
                        if (vmiRef[j]['uuid'] == vmiUUID) {
                            results[i]['floating-ip']['virtual_machine_interface_refs'].splice(j,1);
                            j--;
                            vmiRefLen--;
                            commonUtils.createReqObj(DataObjectArr, floatingIPURL,
                            global.HTTP_REQUEST_PUT, results[i], null, null,
                            appData);
                        }
                    }
                }
            }
        }
    }
    if (DataObjectArr.length > 0) {
        async.map(DataObjectArr,
              function(item,callback) {
                commonUtils.getAPIServerResponse(configApiServer.apiPut, true,item,callback)
              },
              function(error, results) {
                callback(error, results);
                return
              });
    } else {
        callback(error,null);
    }
}

/**
 * @vmiDelLogicalRout
 * private function
 * 1. Callback for delete create
 * 2. call back for deletePortAsync.
 * 3. remove the reference Logical Router.
 */
function vmiDelLogicalRout (error, results, vmiData, appData, callback)
{
    if (error) {
        callback(error, results, null);
        return;
    }
    var vmiUUID = vmiData['virtual-machine-interface']['uuid'];
    var i = 0;
    var DataObjectArr = []
    if (results.length > 0) {
    var resultLength = results.length;
        for (i = 0; i < resultLength; i++) {
            if (results[i] != null) {
                if ( 'logical-router' in results[i] && 'virtual_machine_interface_refs' in results[i]['logical-router']) {
                var floatingIPURL = '/logical-router/'+results[i]['logical-router']['uuid'];
                    var vmiRef = results[i]['logical-router']['virtual_machine_interface_refs'];
                    var vmiRefLen = results[i]['logical-router']['virtual_machine_interface_refs'].length;
                    for (var j = 0; j < vmiRefLen; j++) {
                        if (vmiRef[j]['uuid'] == vmiUUID) {
                            results[i]['logical-router']['virtual_machine_interface_refs'].splice(j,1);
                            j--;
                            vmiRefLen--;
                            commonUtils.createReqObj(DataObjectArr, floatingIPURL,
                            global.HTTP_REQUEST_PUT, results[i], null, null,
                            appData);
                        }
                    }
                }
            }
        }
    }

    if (DataObjectArr.length > 0) {
        async.map(DataObjectArr,function(item,callback) {
                commonUtils.getAPIServerResponse(configApiServer.apiPut, true,item,callback)
        },
              function(error, results) {
                callback(error, results);
                return
              });
    } else {
        callback(error,null);
    }
}

/**
 * @listVirtualMachinesCb
 * private function
 * 1. Callback for listVirtualMachines
 * 2. Reads the response of vm list from config api server
 *    and sends it back to the client.
 */
function listVirtualMachinesCb (error, vmListData, response, appData)
{
    var dataObjArr     = [];
    if ("virtual-machines" in vmListData && vmListData["virtual-machines"].length > 0) {
        for (var i = 0; i < vmListData["virtual-machines"].length; i++) {
            var vmData = vmListData["virtual-machines"][i];
            getUrl = '/virtual-machine/' + vmData['uuid'];
            commonUtils.createReqObj(dataObjArr, getUrl,
                global.HTTP_REQUEST_GET, null, null, null,
                appData);
        }
        async.map(dataObjArr,
            commonUtils.getAPIServerResponse(configApiServer.apiGet, false),
                function(error, results) {
                    if (error) {
                        commonUtils.handleJSONResponse(error, response, null);
                        return;
                    } else {
                        commonUtils.handleJSONResponse(error, response, results);
                        return;
                    }
                });
    } else {
        commonUtils.handleJSONResponse(error, response, null);
        return;
    }
}

/**
 * @listVirtualMachines
 * public function
 * 1. URL /api/tenants/config/virtual-machines
 * 2. Gets list of virtual machines from config api server
 * 3. Calls listVirtualMachinesCb that process data from config
 *    api server and sends back the http response.
 */
function listVirtualMachines (request, response, appData)
{
    var vmListURL  = '/virtual-machines';

    configApiServer.apiGet(vmListURL, appData,
        function(error, data) {
            if (error) {
                commonUtils.handleJSONResponse(error, response, null);
                return;
            } else {
                listVirtualMachinesCb(error, data, response, appData)
            }
        });
}

exports.listVirtualMachines = listVirtualMachines;
exports.readPorts = readPorts;
exports.createPort = createPort;
exports.createPortCB = createPortCB;
exports.updatePorts = updatePorts;
exports.updatePortsCB = updatePortsCB;
exports.deletePorts = deletePorts;
exports.deletePortsCB = deletePortsCB;