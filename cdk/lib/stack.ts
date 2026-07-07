import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";

/**
 * MetaHuman を AWS の GPU でお試しするためのリモートワークステーション。
 *
 * 設計方針:
 *  - コスト安全装置(自動停止/予算)は CDK には持たせない。停止運用は外部(LINE リマインダー)で行う。
 *  - 普段の準備作業(Unreal/MetaHuman のダウンロード・インストール)は GPU 不要なので、
 *    既定は安い t3.large で起動し、GPU が必要なときだけ scripts/switch-type.sh で g5 系へ切り替える。
 *  - ルート EBS は付け替えても残るため、準備した内容はインスタンスタイプを変えても保持される。
 *  - NAT Gateway / Elastic IP は使わない(停止中の放置課金をゼロにするため)。
 */
export class MetahumanGpuDcvTrialStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const project = "metahuman-gpu-dcv-trial";
    const ctx = (key: string): string | undefined => this.node.tryGetContext(key);

    const allowedIp: string | undefined = ctx("allowed_ip");
    if (!allowedIp) {
      throw new Error(
        "context 'allowed_ip' は必須です。例: -c allowed_ip=203.0.113.10/32"
      );
    }
    const keyName: string | undefined = ctx("key_name");
    if (!keyName) {
      throw new Error(
        "context 'key_name' は必須です(Windows Administrator パスワード復号用の既存キーペア名)。"
      );
    }
    const suffix: string = ctx("suffix") ?? this.account;
    const instanceType: string = ctx("instance_type") ?? "t3.large";
    const volumeGb: number = Number(ctx("volume_gb") ?? 200);

    // --- VPC: NAT なし・パブリックサブネットのみ(放置課金を作らない) ---
    const vpc = new ec2.Vpc(this, "Vpc", {
      maxAzs: 1,
      natGateways: 0,
      subnetConfiguration: [
        { name: "public", subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
      ],
    });

    // --- Security Group: DCV(8443 tcp/udp) と RDP(3389) を自分の IP のみに開放 ---
    const sg = new ec2.SecurityGroup(this, "Sg", {
      vpc,
      description: `${project} DCV/RDP from allowed_ip only`,
      allowAllOutbound: true,
    });
    const peer = ec2.Peer.ipv4(allowedIp);
    sg.addIngressRule(peer, ec2.Port.tcp(8443), "NICE DCV (TCP)");
    sg.addIngressRule(peer, ec2.Port.udp(8443), "NICE DCV (QUIC/UDP)");
    sg.addIngressRule(peer, ec2.Port.tcp(3389), "RDP fallback");

    // --- IAM ロール: SSM + S3 読み取り(NVIDIA ドライバ / DCV ライセンス取得用) ---
    const role = new iam.Role(this, "InstanceRole", {
      roleName: `${project}-${suffix}-ec2-role`,
      assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore"),
        iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonS3ReadOnlyAccess"),
      ],
    });

    // --- UserData(PowerShell): persist=true で毎起動実行 ---
    //  DCV は常に導入(準備作業のリモート接続に必要)。
    //  NVIDIA ドライバは GPU 機種(g*/p*)で未導入のときだけ導入 → t3 で準備、g5 切替後に自動で入る。
    const userData = ec2.UserData.forWindows({ persist: true });
    userData.addCommands(
      "$token = Invoke-RestMethod -Method PUT -Uri http://169.254.169.254/latest/api/token -Headers @{'X-aws-ec2-metadata-token-ttl-seconds'='300'}",
      "$itype = Invoke-RestMethod -Uri http://169.254.169.254/latest/meta-data/instance-type -Headers @{'X-aws-ec2-metadata-token'=$token}",
      "if (-not (Test-Path 'C:\\Program Files\\NICE\\DCV\\Server\\bin\\dcv.exe')) {",
      "  Invoke-WebRequest -Uri https://d1uj6qtbmh3dt5.cloudfront.net/nice-dcv-server-x64-Release.msi -OutFile C:\\dcv.msi",
      "  Start-Process msiexec.exe -ArgumentList '/i C:\\dcv.msi /quiet /norestart ADDLOCAL=ALL' -Wait",
      "}",
      "if (($itype -like 'g*' -or $itype -like 'p*') -and -not (Test-Path 'C:\\Windows\\System32\\nvidia-smi.exe')) {",
      "  New-Item -ItemType Directory -Force -Path C:\\nvidia | Out-Null",
      "  aws s3 cp --recursive s3://ec2-windows-nvidia-drivers/latest/ C:\\nvidia\\",
      "  $exe = Get-ChildItem C:\\nvidia -Filter *.exe -Recurse | Select-Object -First 1",
      "  if ($exe) { Start-Process -FilePath $exe.FullName -ArgumentList '-s -noreboot' -Wait; Restart-Computer -Force }",
      "}"
    );

    // --- EC2 インスタンス ---
    const instance = new ec2.Instance(this, "Instance", {
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      instanceType: new ec2.InstanceType(instanceType),
      machineImage: ec2.MachineImage.latestWindows(
        ec2.WindowsVersion.WINDOWS_SERVER_2022_ENGLISH_FULL_BASE
      ),
      securityGroup: sg,
      role,
      keyName,
      userData,
      blockDevices: [
        {
          deviceName: "/dev/sda1",
          volume: ec2.BlockDeviceVolume.ebs(volumeGb, {
            volumeType: ec2.EbsDeviceVolumeType.GP3,
            deleteOnTermination: true,
          }),
        },
      ],
    });
    cdk.Tags.of(instance).add("Name", `${project}-${suffix}`);

    // --- 出力 ---
    new cdk.CfnOutput(this, "InstanceId", { value: instance.instanceId });
    new cdk.CfnOutput(this, "NameTag", { value: `${project}-${suffix}` });
    new cdk.CfnOutput(this, "Region", { value: this.region });
    new cdk.CfnOutput(this, "ConnectHint", {
      value:
        "起動後 scripts/connect-info.sh でパブリック IP を取得し https://<IP>:8443 (DCV) へ",
    });
  }
}
