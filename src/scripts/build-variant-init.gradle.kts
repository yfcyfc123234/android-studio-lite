/**
 * Gradle init script: print Android module build variants for Android Studio Lite.
 *
 * Protocol (unchanged):
 * ```
 * ANDROID_BUILD_VARIANTS_PROTOCOL={
 *   "schemaVersion": 1,
 *   "generatedAt": ...,
 *   "modules": {
 *     ":app": {
 *       "type": "application",
 *       "variants": [
 *         {
 *           "name": "debug",
 *           "buildType": "debug",
 *           "flavors": [],
 *           "applicationId": "com.example.app",
 *           "tasks": {
 *             "assemble": ":app:assembleDebug",
 *             "install": ":app:installDebug"
 *           }
 *         }
 *       ]
 *     }
 *   }
 * }
 * ```
 *
 * Compatibility:
 * - AGP 9+ (android.newDsl / no legacy Variant API): collect via androidComponents.onVariants
 * - AGP 7/8 and AGP 9 with android.newDsl=false: fall back to applicationVariants / libraryVariants
 */
val collectedByPath =
    java.util.concurrent.ConcurrentHashMap<String, MutableList<Map<String, Any?>>>()
val moduleTypeByPath =
    java.util.concurrent.ConcurrentHashMap<String, String>()

fun capitalizeVariant(name: String): String =
    name.replaceFirstChar { if (it.isLowerCase()) it.titlecase() else it.toString() }

fun readNoArg(obj: Any, names: List<String>): Any? {
    for (n in names) {
        try {
            val m = obj.javaClass.methods.firstOrNull { it.name == n && it.parameterCount == 0 }
                ?: continue
            return m.invoke(obj)
        } catch (_: Throwable) {
        }
    }
    return null
}

fun unwrapStringProperty(value: Any?): String? {
    if (value == null) return null
    if (value is String) return value
    return try {
        val get = value.javaClass.methods.firstOrNull { it.name == "get" && it.parameterCount == 0 }
        get?.invoke(value) as? String
    } catch (_: Throwable) {
        null
    }
}

fun flavorNamesFromVariant(variant: Any): List<String> {
    val raw = readNoArg(variant, listOf("getProductFlavors")) ?: return emptyList()
    if (raw !is List<*>) return emptyList()
    return raw.mapNotNull { item ->
        when (item) {
            null -> null
            is String -> item
            is Pair<*, *> -> item.second as? String
            else ->
                (readNoArg(item, listOf("getSecond", "component2")) as? String)
                    ?: (readNoArg(item, listOf("getName")) as? String)
        }
    }
}

fun buildTypeFromVariant(variant: Any): String {
    val raw = readNoArg(variant, listOf("getBuildType"))
    return when (raw) {
        is String -> raw
        null -> ""
        else -> (readNoArg(raw, listOf("getName")) as? String) ?: ""
    }
}

/** Root path is ":" — must become ":installDebug", never "::installDebug". */
fun gradleTaskPath(projectPath: String, taskName: String): String {
    return if (projectPath.isEmpty() || projectPath == ":") {
        ":$taskName"
    } else {
        "$projectPath:$taskName"
    }
}

fun unwrapBooleanProperty(value: Any?): Boolean? {
    when (value) {
        null -> return null
        is Boolean -> return value
    }
    for (m in listOf("get", "getOrNull", "getOrElse")) {
        try {
            val method =
                if (m == "getOrElse") {
                    value!!.javaClass.methods.firstOrNull {
                        it.name == m && it.parameterCount == 1
                    } ?: continue
                } else {
                    value!!.javaClass.methods.firstOrNull {
                        it.name == m && it.parameterCount == 0
                    } ?: continue
                }
            val raw =
                if (m == "getOrElse") {
                    method.invoke(value, false)
                } else {
                    method.invoke(value)
                }
            if (raw is Boolean) return raw
        } catch (_: Throwable) {
        }
    }
    return null
}

/** Prefer Variant/BuildType debuggable; install* is only reliable for debuggable app variants. */
fun isDebuggableVariant(variant: Any): Boolean {
    for (m in listOf("getDebuggable", "isDebuggable", "getIsDebuggable")) {
        try {
            val raw = variant.javaClass.getMethod(m).invoke(variant)
            val b = unwrapBooleanProperty(raw) ?: (raw as? Boolean)
            if (b != null) return b
        } catch (_: Throwable) {
        }
    }
    try {
        val buildTypeObj = variant.javaClass.getMethod("getBuildType").invoke(variant) ?: return false
        for (m in listOf("getDebuggable", "isDebuggable", "getIsDebuggable")) {
            try {
                val raw = buildTypeObj.javaClass.getMethod(m).invoke(buildTypeObj)
                val b = unwrapBooleanProperty(raw) ?: (raw as? Boolean)
                if (b != null) return b
            } catch (_: Throwable) {
            }
        }
    } catch (_: Throwable) {
    }
    return false
}

fun shouldExposeInstall(project: Project, isApp: Boolean, variant: Any, variantCap: String): Boolean {
    if (!isApp) return false
    // Legacy ApplicationVariant.install is null when AGP did not create install*
    try {
        val install = variant.javaClass.getMethod("getInstall").invoke(variant)
        if (install != null) return true
    } catch (_: Throwable) {
    }
    if (isDebuggableVariant(variant)) return true
    try {
        if (project.tasks.findByName("install$variantCap") != null) return true
    } catch (_: Throwable) {
    }
    return false
}

fun buildVariantEntry(
    projectPath: String,
    isApp: Boolean,
    name: String,
    buildType: String,
    flavors: List<String>,
    applicationId: String?,
    includeInstall: Boolean,
): Map<String, Any?> {
    val variantCap = capitalizeVariant(name)
    val tasks = linkedMapOf<String, String>()
    tasks["assemble"] = gradleTaskPath(projectPath, "assemble$variantCap")
    if (includeInstall) {
        tasks["install"] = gradleTaskPath(projectPath, "install$variantCap")
    }
    if (isApp && buildType == "release") {
        tasks["bundle"] = gradleTaskPath(projectPath, "bundle$variantCap")
    }
    return mapOf(
        "name" to name,
        "buildType" to buildType,
        "flavors" to flavors,
        "applicationId" to applicationId,
        "tasks" to tasks,
    )
}

fun addCollectedVariant(project: Project, isApp: Boolean, variant: Any) {
    val name = readNoArg(variant, listOf("getName")) as? String ?: return
    val buildType = buildTypeFromVariant(variant)
    val flavors = flavorNamesFromVariant(variant)
    val applicationId =
        if (isApp) unwrapStringProperty(readNoArg(variant, listOf("getApplicationId"))) else null
    val projectPath = project.path
    val variantCap = capitalizeVariant(name)
    moduleTypeByPath[projectPath] = if (isApp) "application" else "library"
    val list =
        collectedByPath.getOrPut(projectPath) {
            java.util.Collections.synchronizedList(mutableListOf())
        }
    list.add(
        buildVariantEntry(
            projectPath,
            isApp,
            name,
            buildType,
            flavors,
            applicationId,
            shouldExposeInstall(project, isApp, variant, variantCap),
        ),
    )
}

/**
 * AGP 7+ Variant API via androidComponents.
 * AGP 9 removes legacy applicationVariants; this is the primary path there.
 */
fun registerAndroidComponentsCollector(project: Project, isApp: Boolean) {
    val ac = project.extensions.findByName("androidComponents") ?: return
    try {
        val selectorMethod =
            ac.javaClass.methods.firstOrNull { it.name == "selector" && it.parameterCount == 0 }
                ?: return
        val selector = selectorMethod.invoke(ac) ?: return
        val onVariants =
            ac.javaClass.methods.firstOrNull {
                it.name == "onVariants" &&
                    it.parameterCount == 2 &&
                    it.parameterTypes[1].name == "org.gradle.api.Action"
            } ?: return
        val actionClass = onVariants.parameterTypes[1]
        val proxy =
            java.lang.reflect.Proxy.newProxyInstance(
                actionClass.classLoader,
                arrayOf(actionClass),
            ) { _, method, args ->
                if (method.name == "execute" && args != null && args.isNotEmpty() && args[0] != null) {
                    addCollectedVariant(project, isApp, args[0])
                }
                null
            }
        onVariants.invoke(ac, selector, proxy)
    } catch (_: Throwable) {
        // Fall back to legacy Variant API in the print task when needed
    }
}

gradle.beforeProject {
    val p = this
    pluginManager.withPlugin("com.android.application") {
        registerAndroidComponentsCollector(p, true)
    }
    pluginManager.withPlugin("com.android.library") {
        registerAndroidComponentsCollector(p, false)
    }
}

gradle.rootProject {
    tasks.create("printAndroidVariants") {
        doLast {
            fun toJson(value: Any?): String =
                when (value) {
                    null -> "null"
                    is String -> "\"${value.replace("\\", "\\\\").replace("\"", "\\\"")}\""
                    is Number, is Boolean -> value.toString()
                    is Map<*, *> ->
                        value.entries.joinToString(prefix = "{", postfix = "}") { (k, v) ->
                            "\"$k\":${toJson(v)}"
                        }
                    is Iterable<*> ->
                        value.joinToString(prefix = "[", postfix = "]") { toJson(it) }
                    else -> "\"$value\""
                }

            fun collectLegacyModules(): Map<String, Any?> {
                val modules = linkedMapOf<String, Any?>()
                for (project in rootProject.subprojects) {
                    val isApp = project.plugins.hasPlugin("com.android.application")
                    val isLib = project.plugins.hasPlugin("com.android.library")
                    if (!isApp && !isLib) continue

                    val androidExt = project.extensions.findByName("android") ?: continue
                    val variantsList = mutableListOf<Map<String, Any?>>()

                    fun readLegacyVariants(methodName: String) {
                        val target =
                            androidExt.javaClass.methods.firstOrNull { it.name == methodName }
                                ?: return
                        val variants = try {
                            target.invoke(androidExt) as? Iterable<*>
                        } catch (_: Throwable) {
                            null
                        } ?: return

                        for (variant in variants) {
                            val v = variant ?: continue
                            val name =
                                try {
                                    v.javaClass.getMethod("getName").invoke(v) as String
                                } catch (_: Throwable) {
                                    continue
                                }

                            val applicationId: String? =
                                if (isApp) {
                                    try {
                                        val getAppId =
                                            v.javaClass.methods.firstOrNull {
                                                it.name == "getApplicationId"
                                            }
                                        when (val value = getAppId?.invoke(v)) {
                                            is String -> value
                                            else -> unwrapStringProperty(value)
                                        }
                                    } catch (_: Throwable) {
                                        null
                                    }
                                } else {
                                    null
                                }

                            val buildType =
                                try {
                                    val buildTypeObj =
                                        v.javaClass.getMethod("getBuildType").invoke(v)
                                    buildTypeObj.javaClass.getMethod("getName").invoke(buildTypeObj) as String
                                } catch (_: Throwable) {
                                    ""
                                }

                            val flavorNames = mutableListOf<String>()
                            try {
                                val flavorObjs =
                                    v.javaClass.getMethod("getProductFlavors").invoke(v) as List<*>
                                for (f in flavorObjs) {
                                    if (f == null) continue
                                    flavorNames.add(
                                        f.javaClass.getMethod("getName").invoke(f) as String,
                                    )
                                }
                            } catch (_: Throwable) {
                            }

                            variantsList.add(
                                buildVariantEntry(
                                    project.path,
                                    isApp,
                                    name,
                                    buildType,
                                    flavorNames,
                                    applicationId,
                                    shouldExposeInstall(project, isApp, v, capitalizeVariant(name)),
                                ),
                            )
                        }
                    }

                    // Legacy Variant API (AGP ≤8, or AGP 9 with android.newDsl=false)
                    readLegacyVariants("getApplicationVariants")
                    readLegacyVariants("getLibraryVariants")

                    if (variantsList.isNotEmpty()) {
                        modules[project.path] =
                            mapOf(
                                "type" to if (isApp) "application" else "library",
                                "variants" to variantsList,
                            )
                    }
                }
                return modules
            }

            fun collectFromAndroidComponents(): Map<String, Any?> {
                val modules = linkedMapOf<String, Any?>()
                for (path in collectedByPath.keys.sorted()) {
                    val variants = collectedByPath[path] ?: continue
                    if (variants.isEmpty()) continue
                    val type = moduleTypeByPath[path] ?: "library"
                    // Snapshot under lock; drop any accidental duplicates by variant name
                    val snapshot =
                        synchronized(variants) {
                            val seen = linkedSetOf<String>()
                            variants.mapNotNull { entry ->
                                val n = entry["name"] as? String ?: return@mapNotNull null
                                if (!seen.add(n)) return@mapNotNull null
                                entry
                            }
                        }
                    if (snapshot.isEmpty()) continue
                    modules[path] =
                        mapOf(
                            "type" to type,
                            "variants" to snapshot,
                        )
                }
                return modules
            }

            // Prefer androidComponents (AGP 9+); legacy only when that path yielded nothing
            var modules = collectFromAndroidComponents()
            if (modules.isEmpty()) {
                modules = collectLegacyModules()
            }

            val result =
                mapOf(
                    "schemaVersion" to 1,
                    "generatedAt" to System.currentTimeMillis(),
                    "modules" to modules,
                )

            println("ANDROID_BUILD_VARIANTS_PROTOCOL=${toJson(result)}")
        }
    }
}
