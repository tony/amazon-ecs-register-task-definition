const run = require('.');
const core = require('@actions/core');
const fs = require('fs');
const path = require('path');

jest.mock('@actions/core');
jest.mock('fs', () => ({
    promises: { access: jest.fn() },
    readFileSync: jest.fn(),
}));

const mockEcsRegisterTaskDef = jest.fn();
const mockEcsUpdateService = jest.fn();
const mockEcsDescribeServices = jest.fn();
const mockEcsWaiter = jest.fn();
const mockCodeDeployCreateDeployment = jest.fn();
const mockCodeDeployGetDeploymentGroup = jest.fn();
const mockCodeDeployWaiter = jest.fn();
let config = {
  region: 'fake-region',
};

jest.mock('aws-sdk', () => {
    return {
        config,
        ECS: jest.fn(() => ({
            registerTaskDefinition: mockEcsRegisterTaskDef,
            updateService: mockEcsUpdateService,
            describeServices: mockEcsDescribeServices,
            waitFor: mockEcsWaiter
        })),
        CodeDeploy: jest.fn(() => ({
            createDeployment: mockCodeDeployCreateDeployment,
            getDeploymentGroup: mockCodeDeployGetDeploymentGroup,
            waitFor: mockCodeDeployWaiter
        }))
    };
});

describe('Deploy to ECS', () => {

    beforeEach(() => {
        jest.clearAllMocks();

        core.getInput = jest
            .fn()
            .mockReturnValueOnce('task-definition.json') // task-definition
            .mockReturnValueOnce('service-456')         // service
            .mockReturnValueOnce('cluster-789');        // cluster

        process.env = Object.assign(process.env, { GITHUB_WORKSPACE: __dirname });

        fs.readFileSync.mockImplementation((pathInput, encoding) => {
            if (encoding != 'utf8') {
                throw new Error(`Wrong encoding ${encoding}`);
            }

            if (pathInput == path.join(process.env.GITHUB_WORKSPACE, 'appspec.yaml')) {
                return `
                Resources:
                - TargetService:
                    Type: AWS::ECS::Service
                    Properties:
                      TaskDefinition: helloworld
                      LoadBalancerInfo:
                        ContainerName: web
                        ContainerPort: 80`;
            }

            if (pathInput == path.join(process.env.GITHUB_WORKSPACE, 'task-definition.json')) {
                return JSON.stringify({ family: 'task-def-family' });
            }

            throw new Error(`Unknown path ${pathInput}`);
        });

        mockEcsRegisterTaskDef.mockImplementation(() => {
            return {
                promise() {
                    return Promise.resolve({ taskDefinition: { taskDefinitionArn: 'task:def:arn' } });
                }
            };
        });

        mockEcsUpdateService.mockImplementation(() => {
            return {
                promise() {
                    return Promise.resolve({});
                }
            };
        });

        mockEcsDescribeServices.mockImplementation(() => {
            return {
                promise() {
                    return Promise.resolve({
                        failures: [],
                        services: [{
                            status: 'ACTIVE'
                        }]
                    });
                }
            };
        });

        mockEcsWaiter.mockImplementation(() => {
            return {
                promise() {
                    return Promise.resolve({});
                }
            };
        });
    });

    test('cleans null keys out of the task definition contents', async () => {
        fs.readFileSync.mockImplementation((pathInput, encoding) => {
            if (encoding != 'utf8') {
                throw new Error(`Wrong encoding ${encoding}`);
            }

            return '{ "ipcMode": null, "family": "task-def-family" }';
        });

        await run();
        expect(core.setFailed).toHaveBeenCalledTimes(0);
        expect(mockEcsRegisterTaskDef).toHaveBeenNthCalledWith(1, { family: 'task-def-family'});
    });

    test('cleans empty arrays out of the task definition contents', async () => {
        fs.readFileSync.mockImplementation((pathInput, encoding) => {
            if (encoding != 'utf8') {
                throw new Error(`Wrong encoding ${encoding}`);
            }

            return '{ "tags": [], "family": "task-def-family" }';
        });

        await run();
        expect(core.setFailed).toHaveBeenCalledTimes(0);
        expect(mockEcsRegisterTaskDef).toHaveBeenNthCalledWith(1, { family: 'task-def-family'});
    });

    test('cleans empty strings and objects out of the task definition contents', async () => {
        fs.readFileSync.mockImplementation((pathInput, encoding) => {
            if (encoding != 'utf8') {
                throw new Error(`Wrong encoding ${encoding}`);
            }

            return `
            {
                "memory": "",
                "containerDefinitions": [ {
                    "name": "sample-container",
                    "logConfiguration": {},
                    "repositoryCredentials": { "credentialsParameter": "" },
                    "command": [
                        ""
                    ],
                    "environment": [
                        {
                            "name": "hello",
                            "value": "world"
                        },
                        {
                            "name": "test",
                            "value": ""
                        },
                        {
                            "name": "",
                            "value": ""
                        }
                    ],
                    "secretOptions": [ {
                        "name": "",
                        "valueFrom": ""
                    } ],
                    "cpu": 0,
                    "essential": false
                } ],
                "requiresCompatibilities": [ "EC2" ],
                "registeredAt": 1611690781,
                "family": "task-def-family"
            }
            `;
        });

        await run();
        expect(core.setFailed).toHaveBeenCalledTimes(0);
        expect(mockEcsRegisterTaskDef).toHaveBeenNthCalledWith(1, {
            family: 'task-def-family',
            containerDefinitions: [
                {
                    name: 'sample-container',
                    cpu: 0,
                    essential: false,
                    environment: [{
                        name: 'hello',
                        value: 'world'
                    }, {
                        "name": "test",
                        "value": ""
                    }]
                }
            ],
            requiresCompatibilities: [ 'EC2' ]
        });
    });

    test('maintains empty keys in proxyConfiguration.properties for APPMESH', async () => {
        fs.readFileSync.mockImplementation((pathInput, encoding) => {
            if (encoding != 'utf8') {
                throw new Error(`Wrong encoding ${encoding}`);
            }

            return `
            {
                "memory": "",
                "containerDefinitions": [ {
                    "name": "sample-container",
                    "logConfiguration": {},
                    "repositoryCredentials": { "credentialsParameter": "" },
                    "command": [
                        ""
                    ],
                    "environment": [
                        {
                            "name": "hello",
                            "value": "world"
                        },
                        {
                            "name": "",
                            "value": ""
                        }
                    ],
                    "secretOptions": [ {
                        "name": "",
                        "valueFrom": ""
                    } ],
                    "cpu": 0,
                    "essential": false
                } ],
                "requiresCompatibilities": [ "EC2" ],
                "registeredAt": 1611690781,
                "family": "task-def-family",
                "proxyConfiguration": {
                    "type": "APPMESH",
                    "containerName": "envoy",
                    "properties": [
                        {
                            "name": "ProxyIngressPort",
                            "value": "15000"
                        },
                        {
                            "name": "AppPorts",
                            "value": "1234"
                        },
                        {
                            "name": "EgressIgnoredIPs",
                            "value": "169.254.170.2,169.254.169.254"
                        },
                        {
                            "name": "IgnoredGID",
                            "value": ""
                        },
                        {
                            "name": "EgressIgnoredPorts",
                            "value": ""
                        },
                        {
                            "name": "IgnoredUID",
                            "value": "1337"
                        },
                        {
                            "name": "ProxyEgressPort",
                            "value": "15001"
                        },
                        {
                            "value": "some-value"
                        }
                    ]
                }
            }
            `;
        });

        await run();
        expect(core.setFailed).toHaveBeenCalledTimes(0);
        expect(mockEcsRegisterTaskDef).toHaveBeenNthCalledWith(1, {
            family: 'task-def-family',
            containerDefinitions: [
                {
                    name: 'sample-container',
                    cpu: 0,
                    essential: false,
                    environment: [{
                        name: 'hello',
                        value: 'world'
                    }]
                }
            ],
            requiresCompatibilities: [ 'EC2' ],
            proxyConfiguration: {
                type: "APPMESH",
                containerName: "envoy",
                properties: [
                    {
                        name: "ProxyIngressPort",
                        value: "15000"
                    },
                    {
                        name: "AppPorts",
                        value: "1234"
                    },
                    {
                        name: "EgressIgnoredIPs",
                        value: "169.254.170.2,169.254.169.254"
                    },
                    {
                        name: "IgnoredGID",
                        value: ""
                    },
                    {
                        name: "EgressIgnoredPorts",
                        value: ""
                    },
                    {
                        name: "IgnoredUID",
                        value: "1337"
                    },
                    {
                        name: "ProxyEgressPort",
                        value: "15001"
                    },
                    {
                        name: "",
                        value: "some-value"
                    }
                ]
            }
        });
    });

    test('cleans invalid keys out of the task definition contents', async () => {
        fs.readFileSync.mockImplementation((pathInput, encoding) => {
            if (encoding != 'utf8') {
                throw new Error(`Wrong encoding ${encoding}`);
            }

            return '{ "compatibilities": ["EC2"], "taskDefinitionArn": "arn:aws...:task-def-family:1", "family": "task-def-family", "revision": 1, "status": "ACTIVE" }';
        });

        await run();
        expect(core.setFailed).toHaveBeenCalledTimes(0);
        expect(mockEcsRegisterTaskDef).toHaveBeenNthCalledWith(1, { family: 'task-def-family'});
    });

    test('registers the task definition contents', async () => {
        core.getInput = jest
            .fn()
            .mockReturnValueOnce('task-definition.json');  // task-definition

        mockEcsDescribeServices.mockImplementation(() => {
            return {
                promise() {
                    return Promise.resolve({
                        failures: [],
                        services: [{
                            status: 'ACTIVE',
                            deploymentController: {
                                type: 'CODE_DEPLOY'
                            }
                        }]
                    });
                }
            };
        });

        await run();
        expect(core.setFailed).toHaveBeenCalledTimes(0);

        expect(mockEcsRegisterTaskDef).toHaveBeenNthCalledWith(1, { family: 'task-def-family'});
        expect(core.setOutput).toHaveBeenNthCalledWith(1, 'task-definition-arn', 'task:def:arn');
    });

    test('does not wait for a CodeDeploy deployment, parses JSON appspec file', async () => {
        core.getInput = jest
            .fn()
            .mockReturnValueOnce('task-definition.json') // task-definition
            .mockReturnValueOnce('service-456')         // service
            .mockReturnValueOnce('cluster-789');        // cluster

        fs.readFileSync.mockReturnValue(`
            {
                "Resources": [
                    {
                        "TargetService": {
                            "Type": "AWS::ECS::Service",
                            "Properties": {
                                "TaskDefinition": "helloworld",
                                "LoadBalancerInfo": {
                                    "ContainerName": "web",
                                    "ContainerPort": 80
                                }
                            }
                        }
                    }
                ]
            }
        `);

        fs.readFileSync.mockImplementation((pathInput, encoding) => {
            if (encoding != 'utf8') {
                throw new Error(`Wrong encoding ${encoding}`);
            }

            if (pathInput == path.join('/hello/appspec.json')) {
                return `
                {
                    "Resources": [
                        {
                            "TargetService": {
                                "Type": "AWS::ECS::Service",
                                "Properties": {
                                    "TaskDefinition": "helloworld",
                                    "LoadBalancerInfo": {
                                        "ContainerName": "web",
                                        "ContainerPort": 80
                                    }
                                }
                            }
                        }
                    ]
                }`;
            }

            if (pathInput == path.join(process.env.GITHUB_WORKSPACE, 'task-definition.json')) {
                return JSON.stringify({ family: 'task-def-family' });
            }

            throw new Error(`Unknown path ${pathInput}`);
        });

        mockEcsDescribeServices.mockImplementation(() => {
            return {
                promise() {
                    return Promise.resolve({
                        failures: [],
                        services: [{
                            status: 'ACTIVE',
                            deploymentController: {
                                type: 'CODE_DEPLOY'
                            }
                        }]
                    });
                }
            };
        });

        await run();
        expect(core.setFailed).toHaveBeenCalledTimes(0);

        expect(mockEcsRegisterTaskDef).toHaveBeenNthCalledWith(1, { family: 'task-def-family'});
        expect(core.setOutput).toHaveBeenNthCalledWith(1, 'task-definition-arn', 'task:def:arn');
    });

    test('registers the task definition content ', async () => {
        core.getInput = jest
            .fn(input => {
                return {
                    'task-definition': 'task-definition.json',
                }[input];
            });

        mockEcsDescribeServices.mockImplementation(() => {
            return {
                promise() {
                    return Promise.resolve({
                        failures: [],
                        services: [{
                            status: 'ACTIVE',
                            deploymentController: {
                                type: 'CODE_DEPLOY'
                            }
                        }]
                    });
                }
            };
        });

        await run();
        expect(core.setFailed).toHaveBeenCalledTimes(0);

        expect(mockEcsRegisterTaskDef).toHaveBeenNthCalledWith(1, { family: 'task-def-family'});
        expect(core.setOutput).toHaveBeenNthCalledWith(1, 'task-definition-arn', 'task:def:arn');
    });

     test('registers the task definition contents at an absolute path', async () => {
        core.getInput = jest.fn().mockReturnValueOnce('/hello/task-definition.json');
        fs.readFileSync.mockImplementation((pathInput, encoding) => {
            if (encoding != 'utf8') {
                throw new Error(`Wrong encoding ${encoding}`);
            }

            if (pathInput == '/hello/task-definition.json') {
                return JSON.stringify({ family: 'task-def-family-absolute-path' });
            }

            throw new Error(`Unknown path ${pathInput}`);
        });

        await run();
        expect(core.setFailed).toHaveBeenCalledTimes(0);

        expect(mockEcsRegisterTaskDef).toHaveBeenNthCalledWith(1, { family: 'task-def-family-absolute-path'});
        expect(core.setOutput).toHaveBeenNthCalledWith(1, 'task-definition-arn', 'task:def:arn');
    });

   test('waits for the service to be stable', async () => {
        core.getInput = jest
            .fn()
            .mockReturnValueOnce('task-definition.json') // task-definition

        await run();
        expect(core.setFailed).toHaveBeenCalledTimes(0);

        expect(mockEcsRegisterTaskDef).toHaveBeenNthCalledWith(1, { family: 'task-def-family'});
        expect(core.setOutput).toHaveBeenNthCalledWith(1, 'task-definition-arn', 'task:def:arn');
    });

    test('force new deployment', async () => {
        core.getInput = jest
            .fn()
            .mockReturnValueOnce('task-definition.json')  // task-definition
            .mockReturnValueOnce('service-456')          // service
            .mockReturnValueOnce('cluster-789')          // cluster
            .mockReturnValueOnce('false')                // wait-for-service-stability
            .mockReturnValueOnce('')                     // wait-for-minutes
            .mockReturnValueOnce('true');                  // force-new-deployment

        await run();
        expect(core.setFailed).toHaveBeenCalledTimes(0);

        expect(mockEcsRegisterTaskDef).toHaveBeenNthCalledWith(1, { family: 'task-def-family'});
        expect(core.setOutput).toHaveBeenNthCalledWith(1, 'task-definition-arn', 'task:def:arn');
    });

    test('defaults to the default cluster', async () => {
        core.getInput = jest
            .fn()
            .mockReturnValueOnce('task-definition.json') // task-definition
            .mockReturnValueOnce('service-456');         // service

        await run();
        expect(core.setFailed).toHaveBeenCalledTimes(0);

        expect(mockEcsRegisterTaskDef).toHaveBeenNthCalledWith(1, { family: 'task-def-family'});
        expect(core.setOutput).toHaveBeenNthCalledWith(1, 'task-definition-arn', 'task:def:arn');
    });

    test('does not update service if none specified', async () => {
        core.getInput = jest
            .fn()
            .mockReturnValueOnce('task-definition.json'); // task-definition

        await run();
        expect(core.setFailed).toHaveBeenCalledTimes(0);

        expect(mockEcsRegisterTaskDef).toHaveBeenNthCalledWith(1, { family: 'task-def-family'});
        expect(core.setOutput).toHaveBeenNthCalledWith(1, 'task-definition-arn', 'task:def:arn');
    });

    test('error is caught if task def registration fails', async () => {
        mockEcsRegisterTaskDef.mockImplementation(() => {
            throw new Error("Could not parse");
        });

        await run();

        expect(core.setFailed).toHaveBeenCalledTimes(2);
        expect(core.setFailed).toHaveBeenNthCalledWith(1, 'Failed to register task definition in ECS: Could not parse');
        expect(core.setFailed).toHaveBeenNthCalledWith(2, 'Could not parse');
    });
 });
