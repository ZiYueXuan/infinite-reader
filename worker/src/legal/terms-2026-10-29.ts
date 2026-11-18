import { TERMS_VERSION } from '../../../shared/terms';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Published agreement snapshot. Keep this text with its version when introducing a successor. */
export function termsBody(appName: string, contactEmail: string) {
  const app = esc(appName), contact = esc(contactEmail);
  return `
<h1>Terms of Use (TOU)</h1>
<p class="meta">Version ${TERMS_VERSION} · Effective October 29, 2026</p>
<p><a href="#english">English</a> · <a href="#chinese">中文使用条款</a></p>
<section id="english" lang="en">
<p>These Terms of Use govern your use of ${app} (“the service”), operated by the service operator reachable at <a href="mailto:${contact}">${contact}</a> (“we”, “us”). Please read them before accepting. You must expressly accept the current version when signing in. If you do not agree, do not sign in or upload content to the service.</p>

<div class="card"><strong>Important: copyright and uploaded books</strong>
<p>You are responsible for ensuring that you have the legal rights needed to upload and use each book or other file. Buying a copy, paying for a subscription, being able to read a book in another app, or being able to export or download a file does not by itself authorise uploading it to a cloud service or processing it with AI. Technical support for a format or a successful upload is not confirmation of permission.</p></div>

<h2>1. Scope and your account</h2>
<p>The service provides personal reading, annotation, storage, synchronisation, search and optional AI features. These terms cover all content you upload, import or otherwise submit, including ebooks, documents, text, images and notes in EPUB and any other format we may support in future. Mentioning a format does not mean it is currently supported. You must be at least 13 and have legal capacity to accept these terms, or have valid parent or guardian authorisation where permitted by applicable law. Protect your sign-in credentials and tell us about suspected unauthorised account use.</p>

<h2>2. Your copyright obligations</h2>
<ul>
<li>You represent that you own the necessary rights, have the rights holder’s permission, or have another valid legal basis for each upload and the processing you request. This includes, as applicable, cloud storage, copying, backup, format conversion, text extraction/OCR, search indexing, synchronisation and transmission to service providers for the features you use.</li>
<li>Check the copyright status, licence terms, territorial restrictions and any source-platform conditions applicable to your use. A work being available online, an attribution, a “personal use” label or a public-domain claim in another country does not automatically establish permission for your particular use.</li>
<li>Do not upload infringing or unlawfully obtained copies, circumvent technological protection measures unlawfully, remove rights-management information unlawfully, or use the service to distribute works without permission. This service does not authorise you to bypass DRM or a third party’s access restrictions.</li>
<li>Keep reasonable evidence of your permission or other legal basis, and provide it if reasonably requested in connection with a rights complaint. Stop the disputed use when you know you lack the necessary rights.</li>
</ul>

<h2>3. Ownership and limited permission to process</h2>
<p>Copyright remains with its rightful owner. Uploading someone else’s book does not make you its copyright owner, and we do not acquire ownership through upload. To the extent you are entitled to do so, you grant us a non-exclusive, limited permission to host, copy, process and display your content solely to provide, secure and maintain the service for you. We may use the service providers described in our <a href="/privacy">Privacy Policy</a> for those purposes.</p>
<p>Processing includes extracting text and creating search indexes/embeddings. When you invoke AI features, relevant questions, passages or images may be sent to the providers described in the Privacy Policy. We do not make your private library publicly available, sell your uploaded books, or use them to train models ourselves. This permission is not a licence to publish or commercially distribute the books. Deleting content ends permission for ongoing service use, subject to processing needed to complete deletion and any retention required by law.</p>

<h2>4. Copyright complaints and enforcement</h2>
<p>Rights holders or their authorised representatives may send a complaint to <a href="mailto:${contact}">${contact}</a> with the subject “Copyright complaint”. Include your identity and contact details, the work and rights concerned, evidence of ownership or authority, enough information to identify the disputed content (such as a book ID or URL), the alleged infringement, and a good-faith statement that the information is accurate and the use is unauthorised.</p>
<p>We will review sufficiently specific complaints and may request more information, restrict access to or remove disputed content, suspend relevant features, or suspend or terminate accounts, including for repeated infringement. Where appropriate and legally permitted, we may notify the uploader and allow a response with evidence of authorisation or error. A response does not guarantee restoration. We will comply with applicable legal processes and binding orders; nothing here replaces statutory notice, response or appeal rights.</p>

<h2>5. Responsibility for uploads and liability</h2>
<p>We provide technical tools and do not warrant that user-supplied files are lawfully sourced or cleared for the requested use. An upload, parse, index, displayed passage or AI response is not our endorsement, copyright clearance or legal advice. You remain responsible for your uploads and use of the service.</p>
<p>To the extent permitted by applicable law, you are responsible for third-party claims and reasonable, substantiated losses and legal expenses to the extent caused by your infringing upload, unlawful use or breach of these terms. We will give reasonable notice of such a claim and an opportunity to respond. This does not make you responsible for losses caused by our own unlawful conduct or fault, or remove any defence or mandatory rights available to you.</p>
<p>To the extent permitted by law, the service is provided “as is” and “as available”, without a guarantee of uninterrupted availability, accuracy, suitability or freedom from data loss. We exclude liability for indirect or consequential losses to the extent legally permitted. <strong>No clause excludes our legal obligations regarding infringement notices, our own conduct, fraud, wilful misconduct, gross negligence, or any liability or consumer rights that cannot lawfully be excluded or limited.</strong> This agreement is not a blanket exemption from copyright law for either party.</p>

<h2>6. Acceptable use, AI and backups</h2>
<p>Do not compromise security, access another user’s content without authorisation, disrupt the service, exceed reasonable rate limits, or use it as an unauthorised distribution service or public library. AI answers and generated interpretations may be wrong even when they cite a source; check important statements and respect copyright when using or sharing outputs. Outputs are not professional advice. Keep independent copies of books and notes you need.</p>

<h2>7. Privacy, changes and ending use</h2>
<p>The <a href="/privacy">Privacy Policy</a> explains collection, processing and deletion of personal data. We record your account ID, accepted terms version, acceptance/recording times and sign-in method to document your express agreement. Acceptance is not permission for unrelated marketing or a waiver of privacy rights.</p>
<p>You may stop using the service, delete books through the app, and request account deletion using the contact address above. We may restrict or end access for violations, legal requirements or threats to the service, subject to applicable law. These actions do not transfer ownership of your content or remove rights and obligations that by their nature survive, including responsibility for earlier unlawful uploads.</p>
<p>We may change the service or these terms. We will publish a dated version and require express acceptance of the current terms before account access continues; continued use alone is not recorded as acceptance of a new version. Mandatory rights under the law applicable to you remain unaffected. Contact us to try to resolve a dispute; this does not restrict access to a competent court or regulator. Both language versions below express the same agreement; any discrepancy will be interpreted consistently with applicable law and mandatory user protections.</p>
</section>

<section id="chinese" lang="zh-CN">
<h1>使用条款（TOU）</h1>
<p class="meta">版本：${TERMS_VERSION} · 生效日期：2026 年 10 月 29 日</p>
<p>本条款适用于您使用 ${app}（“本服务”）。本服务运营方（“我们”）的联系方式为 <a href="mailto:${contact}">${contact}</a>。请在接受前阅读完整条款。登录时，您必须明确接受当前版本；不同意的，请勿登录或向本服务上传内容。</p>
<div class="card"><strong>重要提示：电子书版权及上传责任</strong><p>您有责任确认自己具备上传及使用每一份电子书或文件所需的合法权限。购买副本、付费订阅、可在其他应用中阅读，或者能够导出、下载文件，并不当然意味着有权将其上传至云服务或交由 AI 处理。平台支持某种格式、允许上传或成功解析，不代表已为您取得版权授权。</p></div>
<h2>1. 服务范围与账户</h2>
<p>本服务提供个人阅读、批注、存储、同步、检索及可选 AI 功能。本条款覆盖您上传、导入或以其他方式提交的全部内容，包括电子书、文档、文字、图片及笔记，适用于 EPUB 以及未来可能支持的其他格式；提及某种格式并不代表当前已支持。您应年满 13 周岁，并具备订立本协议的法律能力，或在适用法律允许的情况下取得有效的父母或监护人授权。请保护登录凭证，发现账户疑似被擅自使用时及时联系我们。</p>
<h2>2. 您的版权义务</h2>
<ul>
<li>您声明：对每次上传及所请求的处理，您拥有必要权利、已取得权利人许可，或具有其他有效法律依据。相关权限应覆盖实际使用所涉及的云端存储、复制、备份、格式转换、文字提取或 OCR、检索索引、同步，以及为使用相应功能向服务提供商传输内容。</li>
<li>您应核实作品的版权状态、许可条件、地域限制及来源平台适用的使用条件。作品可在网上获取、标注了作者或“仅供个人使用”，或在其他国家被称为公有领域作品，并不当然证明您的具体使用方式合法。</li>
<li>不得上传侵权或非法取得的副本，不得违法规避技术保护措施、删除权利管理信息，或利用本服务未经许可传播作品。本服务不授权您绕过 DRM 或第三方访问限制。</li>
<li>请合理保存授权或其他合法依据的证明。在处理权利投诉时，我们可以合理要求您提供相关证明；您明知不具备必要权利时，应停止有争议的使用。</li>
</ul>
<h2>3. 权利归属与有限处理许可</h2>
<p>版权始终属于合法权利人。上传他人作品不会使您成为版权人，我们也不会因上传而取得作品所有权。在您有权授权的范围内，您授予我们非独占、有限的许可，仅为向您提供、保障和维护本服务而托管、复制、处理和展示内容；我们可以为这些目的使用<a href="/privacy">隐私政策</a>所列的服务提供商。</p>
<p>相关处理包括文字提取、检索索引和向量化。您使用 AI 功能时，相关问题、段落或图片可能发送给隐私政策说明的提供商。我们不会公开您的私人书库、出售您上传的电子书，或自行将其用于训练模型。本许可不包含出版或商业分发电子书的权利。删除内容后，持续使用该内容提供服务的许可终止，但完成删除所必需的处理及法律要求的保留除外。</p>
<h2>4. 版权投诉与处置</h2>
<p>权利人或其授权代表可发送邮件至 <a href="mailto:${contact}">${contact}</a>，主题注明“版权投诉”。请提供身份与联系方式、涉及的作品及权利、权属或代理资格证明、足以定位争议内容的信息（例如书籍 ID 或链接）、涉嫌侵权的具体说明，以及关于投诉信息准确、相关使用未经授权的善意声明。</p>
<p>我们会审查足够具体的投诉，并可要求补充材料、限制访问或移除争议内容、暂停相关功能，或暂停、终止账户，包括针对重复侵权的情况。在适当且法律允许时，我们可以通知上传者，并允许其提交授权或误判的证明；提交说明并不保证恢复内容。我们遵守适用的法定程序及有约束力的命令；本条款不替代法律规定的通知、答辩或申诉权利。</p>
<h2>5. 上传责任与责任限制</h2>
<p>我们提供技术工具，不保证用户提交的文件来源合法或已获得相应使用授权。上传、解析、索引、展示段落或生成 AI 回答，不构成我们的认可、版权许可或法律意见。您仍应对自己的上传行为及服务使用承担相应责任。</p>
<p>在适用法律允许的范围内，对于因您的侵权上传、违法使用或违反本条款而引起的第三方主张，您应就由此造成的合理、有依据的损失及法律费用承担与自身行为相应的责任。我们会合理通知您相关主张，并给予您回应机会。本约定不要求您承担因我们自身违法行为或过错造成的损失，也不剥夺您依法享有的抗辩及强制性权利。</p>
<p>在法律允许的范围内，本服务按“现状”和“可用状态”提供，不保证持续可用、准确、适合特定用途或不会发生数据丢失；我们仅在法律允许的范围内排除间接或后果性损失责任。<strong>任何条款均不免除我们就侵权通知、自身行为、欺诈、故意不当行为、重大过失所承担的法定义务，也不排除或限制法律禁止排除、限制的责任或消费者权利。</strong>本协议不构成任何一方对版权法律责任的一概免责。</p>
<h2>6. 合理使用、AI 与备份</h2>
<p>不得破坏安全、擅自访问他人内容、干扰服务、超出合理频率限制，或将服务用于未经授权的作品分发、公共书库。AI 回答及解释即使附有引用也可能出错，重要信息应核对原文；使用或分享输出时仍须尊重版权。AI 输出不构成专业意见。请为重要书籍及笔记保留独立备份。</p>
<h2>7. 隐私、变更与终止</h2>
<p><a href="/privacy">隐私政策</a>说明个人数据的收集、处理及删除方式。我们记录账户 ID、接受的条款版本、接受与记录时间、登录方式，以证明您的明确同意。接受本条款不构成对无关营销的授权，也不代表放弃隐私权利。</p>
<p>您可以停止使用服务、在应用内删除书籍，并通过上述联系方式申请删除账户。对于违规、法律要求或威胁服务的情形，我们可依法限制或终止访问；相关措施不转移内容所有权，也不消灭按其性质应继续存在的权利义务，包括对先前违法上传应承担的责任。</p>
<p>我们可能调整服务或条款，并公布注明日期的版本；继续访问账户前须明确接受当前版本，不会仅凭继续使用就将您记为接受了新版本。您依据适用法律享有的强制性权利不受影响。发生争议时可先联系我们协商，但不限制您向有管辖权的法院或监管机构寻求救济。中英文版本表达相同约定，任何差异均应依适用法律及用户的强制性保护规则解释。</p>
</section>`;
}
